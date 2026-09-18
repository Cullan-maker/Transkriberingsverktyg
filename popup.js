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
  
  if (window.location.search.includes('mode=popout')) {
    const btn = document.getElementById('popoutBtn');
    if(btn) btn.style.display = 'none';
  }
  
  const popoutBtn = document.getElementById('popoutBtn');
  if(popoutBtn) {
    popoutBtn.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.windows) {
        chrome.windows.create({
          url: chrome.runtime.getURL("index.html?mode=popout"),
          type: "popup",
          width: 440,
          height: 750
        });
        window.close();
      }
    });
  }

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
    let response;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;

    if (activeTab === 'text') {
      const text = document.getElementById('textInput').value;
      if (!text) {
        clearInterval(progressInterval);
        progressWrapper.style.display = "none";
        return showError("Klistra in text först!");
      }
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt + text }] }] })
      });
    } else {
      let fileBlob = activeTab === 'audio' ? document.getElementById('audioFile').files[0] : recordedAudioBlob;
      if (!fileBlob) {
        clearInterval(progressInterval);
        progressWrapper.style.display = "none";
        return showError("Välj eller spela in en ljudfil först!");
      }
      
      if (fileBlob.size > 15 * 1024 * 1024) {
        showError("Varning: Filen är över 15MB. API:et kan misslyckas. Överväg att klippa filen om det blir fel.");
      }

      const base64Audio = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(fileBlob);
      });

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

    const data = await response.json();
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

  let html = `<h2>📋 Sammanfattning</h2><p>${data.summary}</p>`;
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
}
