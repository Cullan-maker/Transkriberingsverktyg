
let mediaRecorder;
let audioChunks = [];
let recordingInterval;
let secondsRecorded = 0;
let recordedAudioBlob = null;
let audioContext;
let analyser;
let visualizerAnimationId;
let progressInterval;

const colors = ['#ffffff', '#dbeafe', '#dcfce7', '#fef9c3', '#f3e8ff', '#ffe4e6'];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('apiKeyInput').value = localStorage.getItem('geminiApiKey') || '';
  setupTabs();
  loadHistory();
  
  document.getElementById('analyzeBtn').addEventListener('click', handleAnalysis);
  document.getElementById('recordBtn').addEventListener('click', toggleRecording);
  
  document.getElementById('audioFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(file) {
      document.getElementById('fileName').innerText = file.name;
      document.getElementById('fileStatus').style.display = 'block';
    }
  });
});

function setupTabs() {
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
      document.getElementById('settings').style.display = tabId === 'history' ? 'none' : 'block';
      document.getElementById('errorBox').style.display = 'none';
      document.getElementById('status').innerText = '';
      document.getElementById('progressWrapper').style.display = 'none';
    });
  });
}

async function toggleRecording() {
  const btn = document.getElementById('recordBtn');
  const timerDisplay = document.getElementById('timer');
  const visualizer = document.getElementById('visualizer');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    clearInterval(recordingInterval);
    btn.innerHTML = '🔴 Starta Inspelning';
    btn.classList.remove('recording');
    if(visualizerAnimationId) cancelAnimationFrame(visualizerAnimationId);
    if(audioContext) audioContext.close();
    visualizer.style.display = 'none';
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        recordedAudioBlob = new Blob(audioChunks, { type: 'audio/m4a' });
        document.getElementById('status').innerText = 'Ljud inspelat! Klicka på Analysera.';
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
      secondsRecorded = 0;
      timerDisplay.innerText = '00:00';
      btn.innerHTML = '⏹ Stoppa Inspelning';
      btn.classList.add('recording');
      document.getElementById('status').innerText = 'Spelar in...';
      recordingInterval = setInterval(() => {
        secondsRecorded++;
        const m = String(Math.floor(secondsRecorded / 60)).padStart(2, '0');
        const s = String(secondsRecorded % 60).padStart(2, '0');
        timerDisplay.innerText = `${m}:${s}`;
      }, 1000);
      visualizer.style.display = 'block';
      startVisualizer(stream);
    } catch (err) {
      alert("Kunde inte starta mikrofonen. Har du tillåtit åtkomst i webbläsaren?");
    }
  }
}

function startVisualizer(stream) {
  const canvas = document.getElementById('visualizer');
  const canvasCtx = canvas.getContext('2d');
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  analyser.fftSize = 256;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    visualizerAnimationId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    canvasCtx.fillStyle = '#f1f5f9';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;
    for(let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i] / 2;
      canvasCtx.fillStyle = '#4f46e5';
      canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
  }
  draw();
}

function saveToHistory(htmlContent) {
  const dateStr = new Date().toLocaleString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const newItem = { id: Date.now(), date: dateStr, content: htmlContent };
  let history = JSON.parse(localStorage.getItem('transcriptsHistory') || '[]');
  history.unshift(newItem);
  if(history.length > 20) history.pop();
  localStorage.setItem('transcriptsHistory', JSON.stringify(history));
  loadHistory();
}

function loadHistory() {
  const historyList = document.getElementById('historyList');
  let history = JSON.parse(localStorage.getItem('transcriptsHistory') || '[]');
  if(history.length === 0) {
    historyList.innerHTML = '<p style="color:#94a3b8; font-style:italic;">Ingen historik ännu.</p>';
    return;
  }
  historyList.innerHTML = '';
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const infoSpan = document.createElement('span');
    infoSpan.innerHTML = `<span class="history-date">${item.date}</span> (Sparad analys)`;
    infoSpan.style.flexGrow = '1';
    infoSpan.addEventListener('click', () => {
      document.getElementById('result').innerHTML = item.content;
      document.getElementById('result').style.display = 'block';
      setupResultInteractivity();
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'history-delete';
    delBtn.innerText = '❌';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let hist = JSON.parse(localStorage.getItem('transcriptsHistory') || '[]');
      hist = hist.filter(i => i.id !== item.id);
      localStorage.setItem('transcriptsHistory', JSON.stringify(hist));
      loadHistory();
    });
    div.appendChild(infoSpan);
    div.appendChild(delBtn);
    historyList.appendChild(div);
  });
}

// BÖRJAR MED DE MEST AVANCERADE MODELLERNA FÖRST
async function handleAnalysis() {
  const errorBox = document.getElementById('errorBox');
  errorBox.style.display = 'none';

  const GEMINI_API_KEY = document.getElementById('apiKeyInput').value.trim();
  if (!GEMINI_API_KEY) {
    showError("Du måste klistra in din API-nyckel under inställningar!");
    return;
  }
  
  localStorage.setItem('geminiApiKey', GEMINI_API_KEY);

  const activeTab = document.querySelector('.tab-button.active').getAttribute('data-tab');
  const summaryLength = document.querySelector('input[name="summaryLength"]:checked').value;
  const focusInput = document.getElementById('focusInput').value;
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');
  
  const progressWrapper = document.getElementById('progressWrapper');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');

  let fileBlob = null;
  let textData = null;

  if (activeTab === 'text') {
    textData = document.getElementById('textInput').value;
    if (!textData) return showError("Klistra in text först!");
  } else {
    fileBlob = activeTab === 'audio' ? document.getElementById('audioFile').files[0] : recordedAudioBlob;
    if (!fileBlob) return showError("Välj eller spela in en ljudfil först!");
    if (fileBlob.size > 15 * 1024 * 1024) {
      showError("Varning: Filen är över 15MB. API:et kan misslyckas.");
    }
  }

  let prompt = `Analysera följande. Returnera EXAKT och BARA ett JSON-objekt med tre nycklar: 
  "summary" (en ${summaryLength} sammanfattning${focusInput ? ' med fokus på: ' + focusInput : ''}), 
  "speakers" (en array med objekt: {"id": "Talare 1", "role": "Deltagare"}), 
  "transcript" (en array med objekt: {"speaker": "Talare 1", "text": "vad som sades..."}). 
  Viktigt: Din output måste vara giltig JSON. Använd inte markdown runtom, bara rå JSON.\n\n`;

  statusEl.innerText = "⏳ Laddar upp och bearbetar...";
  resultEl.style.display = "none";
  
  progressWrapper.style.display = "block";
  let currentProgress = 0;
  progressBar.style.width = '0%';
  progressText.innerText = '0%';

  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    let step = (95 - currentProgress) * 0.05;
    if (step < 0.2) step = 0.2; 
    currentProgress += step;
    if (currentProgress > 95) currentProgress = 95;

    progressBar.style.width = currentProgress + '%';
    progressText.innerText = Math.floor(currentProgress) + '%';
  }, 500);

  try {
    let data = null;
    let lastErrorMessage = "";
    
    let base64Audio = null;
    if (fileBlob) {
      base64Audio = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(fileBlob);
      });
    }

    // PRIORITERAD LISTA: De mest avancerade/senaste modellerna först
    const modelsToTry = [
      'gemini-2.5-flash',
      'gemini-2.0-flash', 
      'gemini-1.5-pro', 
      'gemini-1.5-flash', 
      'gemini-3.6-flash'
    ];

    for (const model of modelsToTry) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        let response;

        if (textData) {
          response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt + textData }] }] })
          });
        } else {
          response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [
                { text: prompt }, 
                { inlineData: { mimeType: fileBlob.type || 'audio/mp3', data: base64Audio } }
              ]}]
            })
          });
        }

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || `HTTP error ${response.status}`);
        }

        data = await response.json();
        console.log(`✅ Analys lyckades med avancerad modell: ${model}`);
        break; 

      } catch (err) {
        console.warn(`❌ Modell ${model} misslyckades, testar nästa... Felet var:`, err.message);
        lastErrorMessage = err.message;
      }
    }

    if (!data) {
      throw new Error("Alla AI-modeller misslyckades. Sista felet: " + lastErrorMessage);
    }

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error("Fick inget svar från AI. Den kanske bedömde ljudet som otillåtet innehåll.");
    }

    let aiText = data.candidates[0].content.parts[0].text;
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      aiText = jsonMatch[0];
    } else {
      aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
    }
    
    const resultObj = JSON.parse(aiText);
    
    clearInterval(progressInterval);
    progressBar.style.width = '100%';
    progressText.innerText = '100%';

    setTimeout(() => {
      progressWrapper.style.display = 'none';
      renderResult(resultObj);
    }, 500);

  } catch (error) {
    clearInterval(progressInterval);
    progressWrapper.style.display = "none";
    statusEl.innerText = "";
    
    let userMsg = "Fel vid kommunikation med AI.";
    if (error.message.includes('JSON')) {
      userMsg = "AI svarade, men det gick inte att tolka svaret. Prova igen.";
    } else if (error.message.includes('400') || error.message.toLowerCase().includes('size') || error.message.toLowerCase().includes('payload')) {
      userMsg = "Ljudfilen är för stor för att skickas direkt via webbläsaren. Prova en kortare fil eller konvertera till lägre ljudkvalitet.";
    } else if (error.message.toLowerCase().includes('demand')) {
      userMsg = "Googles system är tillfälligt överbelastat. Vänta en minut och klicka på Analysera igen.";
    } else {
      userMsg = `Tekniskt fel: ${error.message}`;
    }
    showError(userMsg);
  }
}

function showError(msg) {
  const errorBox = document.getElementById('errorBox');
  errorBox.innerHTML = `<strong>Fel:</strong> ${msg}`;
  errorBox.style.display = 'block';
  document.getElementById('status').innerText = "";
}

function renderResult(data) {
  const resultEl = document.getElementById('result');
  const statusEl = document.getElementById('status');

  let html = `<h2>📋 Sammanfattning</h2><p id="summaryText">${data.summary}</p>`;
  html += `<h2>👥 Hantera Talare</h2><div class="speaker-controls" id="speakerControls">`;
  data.speakers.forEach((speaker) => {
    html += `
      <div style="margin-bottom: 10px;">
        <input type="text" class="speaker-name-input" data-original="${speaker.id}" value="${speaker.id}" style="width:40%; display:inline-block;">
        <input type="text" class="speaker-role-input" data-original="${speaker.id}" value="${speaker.role || 'Deltagare'}" style="width:40%; display:inline-block;">
        <div style="margin-top: 5px;">
          ${colors.map(c => `<button class="speaker-color-btn" data-speaker="${speaker.id}" style="background-color: ${c}"></button>`).join('')}
        </div>
      </div>
    `;
  });
  html += `</div>`;

  html += `<h2>💬 Transkription</h2><div id="transcriptBox">`;
  data.transcript.forEach(line => {
    html += `
      <div class="transcript-line" data-speaker="${line.speaker}" style="margin-bottom: 10px; padding: 10px; border-radius: 8px; background-color: #ffffff; border: 1px solid #e2e8f0;">
        <strong class="speaker-label" data-speaker="${line.speaker}">${line.speaker}</strong>: 
        <span contenteditable="true" style="padding:2px; display:block; margin-top:4px;" title="Klicka i texten för att redigera">${line.text}</span>
      </div>`;
  });
  html += `</div>`;
  
  html += `
    <div class="export-section" id="exportContainer">
      <div class="export-title">⬇️ Spara eller exportera</div>
      <div class="export-grid">
        <button class="btn-export" id="exportCopy">📋 Kopiera</button>
        <button class="btn-export" id="exportEmail">✉️ Mejla</button>
        <button class="btn-export" id="exportTxt">📄 Text (.txt)</button>
        <button class="btn-export" id="exportWord">📝 Word (.doc)</button>
      </div>
      <button class="btn-export" id="exportPdf" style="width: 100%;">📕 Spara som PDF</button>
    </div>
  `;

  resultEl.innerHTML = html;
  resultEl.style.display = "block";
  statusEl.innerText = "✅ Analys klar!";
  
  setupResultInteractivity();
  saveToHistory(html);
}

function setupResultInteractivity() {
  document.querySelectorAll('.speaker-name-input, .speaker-role-input').forEach(input => {
    input.addEventListener('input', () => {
      const original = input.getAttribute('data-original');
      const parent = input.parentElement;
      const newName = parent.querySelector('.speaker-name-input').value;
      const newRole = parent.querySelector('.speaker-role-input').value;
      const combined = newRole ? `${newName} (${newRole})` : newName;
      document.querySelectorAll(`.speaker-label[data-speaker="${original}"]`).forEach(label => {
        label.innerText = combined;
      });
    });
  });
  
  document.querySelectorAll('.speaker-color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const speakerId = e.target.getAttribute('data-speaker');
      const chosenColor = e.target.style.backgroundColor;
      document.querySelectorAll(`.transcript-line[data-speaker="${speakerId}"]`).forEach(line => {
        line.style.backgroundColor = chosenColor;
      });
    });
  });

  const bindClick = (id, func) => {
    const btn = document.getElementById(id);
    if (btn) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', func);
    }
  };

  bindClick('exportCopy', exportToClipboard);
  bindClick('exportEmail', exportToEmail);
  bindClick('exportTxt', () => exportToFile('txt'));
  bindClick('exportWord', () => exportToFile('word'));
  bindClick('exportPdf', exportToPdf);
}

// --- EXPORT FUNKTIONER ---

function getCleanText() {
  let text = "--- SAMMANFATTNING ---\n\n";
  const summaryP = document.getElementById('summaryText');
  if(summaryP) text += summaryP.innerText + "\n\n";
  
  text += "--- TRANSKRIPTION ---\n\n";
  document.querySelectorAll('.transcript-line').forEach(line => {
      const speaker = line.querySelector('.speaker-label').innerText;
      const spokenText = line.querySelector('span[contenteditable]').innerText;
      text += `${speaker}: ${spokenText}\n\n`;
  });
  return text;
}

function exportToClipboard() {
  const text = getCleanText();
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => alert("✅ Kopierat till urklipp!"));
  } else {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    alert("✅ Kopierat till urklipp!");
  }
}

function exportToEmail() {
  const text = getCleanText();
  const subject = encodeURIComponent("Transkription och sammanfattning");
  const body = encodeURIComponent(text);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

function exportToFile(type) {
  const text = getCleanText();
  let blob;
  let filename;

  if (type === 'txt') {
    blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    filename = 'Transkription.txt';
  } else if (type === 'word') {
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Transkription</title></head><body>
      <h2>Sammanfattning</h2>
      <p>${document.getElementById('summaryText')?.innerText || ''}</p>
      <br><h2>Transkription</h2>
      ${Array.from(document.querySelectorAll('.transcript-line')).map(line => 
        `<p style="margin-bottom:8px;"><strong>${line.querySelector('.speaker-label').innerText}:</strong><br>${line.querySelector('span[contenteditable]').innerText}</p>`
      ).join('')}
      </body></html>
    `;
    blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    filename = 'Transkription.doc';
  }

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportToPdf() {
  const exportContainer = document.getElementById('exportContainer');
  if(exportContainer) exportContainer.style.display = 'none';
  
  const element = document.getElementById('result');
  const opt = {
    margin:       15,
    filename:     'Transkription.pdf',
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  if (typeof html2pdf === 'undefined') {
    alert("PDF-motorn laddas fortfarande in. Vänta 2 sekunder och försök igen!");
    if(exportContainer) exportContainer.style.display = 'flex';
    return;
  }

  html2pdf().set(opt).from(element).save().then(() => {
    if(exportContainer) exportContainer.style.display = 'block';
  });
}
