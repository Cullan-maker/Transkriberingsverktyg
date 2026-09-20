let mediaRecorder;
let audioChunks = [];
let recordingInterval;
let secondsRecorded = 0;
let recordedAudioBlob = null;
let audioContext;
let analyser;
let visualizerAnimationId;
let progressInterval;
let wakeLock = null;

// Global lagring för rå-transkriptionen så vi kan uppdatera sammanfattningen supersnabbt
window.currentRawTranscript = "";

const colors = ['#ffffff', '#dbeafe', '#dcfce7', '#fef9c3', '#f3e8ff', '#ffe4e6'];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('apiKeyInput').value = localStorage.getItem('geminiApiKey') || '';
  document.getElementById('modelSelect').value = localStorage.getItem('geminiModel') || 'auto';
  
  setupTabs();
  loadHistory();
  
  // Återställ auto-save (visas i resultat-fliken)
  const autoSavedHtml = localStorage.getItem('currentDraftHTML');
  if (autoSavedHtml) {
    document.getElementById('result').innerHTML = autoSavedHtml;
    setupResultInteractivity();
    
    // Försök ladda in rå-transkriptionen om den fanns sparad i HTML:en
    const hiddenData = document.getElementById('rawTranscriptData');
    if (hiddenData) {
      window.currentRawTranscript = decodeURIComponent(hiddenData.innerText);
    }
    
    // Hoppa direkt till resultat om det fanns sparat
    showTab('result');
  }

  document.getElementById('modelSelect').addEventListener('change', (e) => localStorage.setItem('geminiModel', e.target.value));
  document.getElementById('apiKeyInput').addEventListener('input', (e) => localStorage.setItem('geminiApiKey', e.target.value));

  // Knyt alla Analysera-knappar till funktionen
  document.querySelectorAll('.analyze-btn').forEach(btn => {
    btn.addEventListener('click', handleAnalysis);
  });

  document.getElementById('recordBtn').addEventListener('click', toggleRecording);
  
  document.getElementById('audioFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(file) {
      document.getElementById('fileName').innerText = file.name;
      document.getElementById('fileStatus').style.display = 'block';
    }
  });

  document.getElementById('closeErrorBtn').addEventListener('click', () => {
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('errorBox').style.display = 'none';
    document.getElementById('closeErrorBtn').style.display = 'none';
  });
});

// FLIK-HANTERING
function showTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  
  // Uppdatera ikonerna i botten
  document.querySelectorAll('.tab-button').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function setupTabs() {
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      showTab(button.getAttribute('data-tab'));
    });
  });
}

// WAKELOCK
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } 
  catch (err) { console.warn("Wake Lock misslyckades", err); }
}
function releaseWakeLock() {
  if (wakeLock !== null) wakeLock.release().then(() => wakeLock = null);
}

// INSPELNING
async function toggleRecording() {
  const btn = document.getElementById('recordBtn');
  const timerDisplay = document.getElementById('timer');
  const visualizer = document.getElementById('visualizer');
  const analyzeLiveBtn = document.getElementById('analyzeLiveBtn');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    clearInterval(recordingInterval);
    btn.innerHTML = '🔴 Starta Ny Inspelning';
    btn.classList.remove('recording');
    if(visualizerAnimationId) cancelAnimationFrame(visualizerAnimationId);
    if(audioContext) audioContext.close();
    visualizer.style.display = 'none';
    analyzeLiveBtn.style.display = 'block'; // Visa analysera-knappen när vi är klara
    releaseWakeLock();
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } 
      });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        recordedAudioBlob = new Blob(audioChunks, { type: 'audio/m4a' });
        stream.getTracks().forEach(track => track.stop());
      };
      
      requestWakeLock();
      mediaRecorder.start();
      secondsRecorded = 0;
      timerDisplay.innerText = '00:00';
      analyzeLiveBtn.style.display = 'none';
      btn.innerHTML = '⏹ Stoppa Inspelning';
      btn.classList.add('recording');
      recordingInterval = setInterval(() => {
        secondsRecorded++;
        const m = String(Math.floor(secondsRecorded / 60)).padStart(2, '0');
        const s = String(secondsRecorded % 60).padStart(2, '0');
        timerDisplay.innerText = `${m}:${s}`;
      }, 1000);
      visualizer.style.display = 'block';
      startVisualizer(stream);
    } catch (err) {
      alert("Kunde inte starta mikrofonen. Har du tillåtit åtkomst i inställningarna?");
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
    canvasCtx.fillStyle = '#f8fafc';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight, x = 0;
    for(let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i] / 2;
      canvasCtx.fillStyle = '#ef4444';
      canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
  }
  draw();
}

// HISTORIK
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
  if(history.length === 0) { historyList.innerHTML = '<p style="color:#94a3b8; font-style:italic;">Ingen historik ännu.</p>'; return; }
  historyList.innerHTML = '';
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const infoSpan = document.createElement('span');
    infoSpan.innerHTML = `<span class="history-date">${item.date}</span> (Sparad analys)`;
    infoSpan.style.flexGrow = '1';
    infoSpan.addEventListener('click', () => {
      document.getElementById('result').innerHTML = item.content;
      localStorage.setItem('currentDraftHTML', item.content);
      
      const hiddenData = document.getElementById('rawTranscriptData');
      if (hiddenData) window.currentRawTranscript = decodeURIComponent(hiddenData.innerText);
      
      setupResultInteractivity();
      showTab('result'); // Hoppar till resultat-fliken när du klickar på en gammal fil!
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

// FILE API
async function uploadToGeminiFileAPI(fileBlob, apiKey) {
  let mimeType = fileBlob.type;
  if (!mimeType) {
    if (fileBlob.name && fileBlob.name.toLowerCase().endsWith('.mp4')) mimeType = 'video/mp4';
    else if (fileBlob.name && fileBlob.name.toLowerCase().endsWith('.mov')) mimeType = 'video/quicktime';
    else mimeType = 'audio/mp3'; 
  }
  
  const startRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': fileBlob.size.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: fileBlob.name || "mobil_upload" } })
  });
  
  const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
  if(!uploadUrl) throw new Error("Kunde inte starta uppladdningen till Googles server.");

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': fileBlob.size.toString(),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: fileBlob
  });
  
  let fileInfo = await uploadRes.json();
  let fileData = fileInfo.file;
  const statusEl = document.getElementById('status');
  
  while (fileData.state === 'PROCESSING') {
    statusEl.innerText = "⏳ Google bearbetar videon (Detta kan ta flera minuter för stora filer)...";
    await new Promise(r => setTimeout(r, 4000));
    const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/files/${fileData.name}?key=${apiKey}`);
    fileData = await checkRes.json();
  }
  
  if (fileData.state === 'FAILED') throw new Error("Google kunde inte bearbeta denna fil.");
  
  return { mimeType: fileData.mimeType, fileUri: fileData.uri };
}

// HUVUDANALYS
async function handleAnalysis() {
  const GEMINI_API_KEY = document.getElementById('apiKeyInput').value.trim();
  if (!GEMINI_API_KEY) {
    showTab('settings');
    alert("Du måste klistra in din API-nyckel under inställningar först!");
    return;
  }

  // Se till att loadingoverlay är städad
  const overlay = document.getElementById('loadingOverlay');
  const errorBox = document.getElementById('errorBox');
  const statusEl = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const closeErrorBtn = document.getElementById('closeErrorBtn');
  
  errorBox.style.display = 'none';
  closeErrorBtn.style.display = 'none';
  overlay.style.display = 'flex';

  const activeTab = document.querySelector('.tab-content.active').id;
  let fileBlob = null;
  let textData = null;

  if (activeTab === 'text') {
    textData = document.getElementById('textInput').value;
    if (!textData) return triggerError("Klistra in text först!");
  } else if (activeTab === 'audio') {
    fileBlob = document.getElementById('audioFile').files[0];
    if (!fileBlob) return triggerError("Välj en mediafil först!");
  } else if (activeTab === 'live') {
    fileBlob = recordedAudioBlob;
    if (!fileBlob) return triggerError("Spela in ljud först!");
  }

  if (fileBlob && fileBlob.size > 2 * 1024 * 1024 * 1024) {
    return triggerError("Varning: Filen är över 2 GB. Välj en mindre fil.");
  }

  // 1. Initial Prompt (Nu gör den alltid en standard-sammanfattning först)
  let prompt = `Analysera följande. Returnera EXAKT och BARA ett JSON-objekt med tre nycklar: 
  "summary" (en bra, allmän sammanfattning av innehållet), 
  "speakers" (en array med objekt: {"id": "Talare 1", "role": "Deltagare"}), 
  "transcript" (en array med objekt: {"speaker": "Talare 1", "text": "vad som sades..."}). 
  Viktigt: Din output måste vara giltig JSON. Använd inte markdown runtom, bara rå JSON.\n\n`;

  statusEl.innerText = "⏳ Letar efter godkända AI-modeller...";
  
  let currentProgress = 0;
  progressBar.style.width = '0%';
  progressText.innerText = '0%';
  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    let step = (95 - currentProgress) * 0.02;
    if (step < 0.1) step = 0.1; 
    currentProgress += step;
    if (currentProgress > 95) currentProgress = 95;
    progressBar.style.width = currentProgress + '%';
    progressText.innerText = Math.floor(currentProgress) + '%';
  }, 500);

  try {
    let fetchedModels = [];
    try {
      const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        fetchedModels = modelsData.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
          .map(m => m.name.replace('models/', ''));
      }
    } catch(err) { console.warn("Kunde inte hämta modell-lista från Google.", err); }

    const selectedModel = document.getElementById('modelSelect').value;
    let modelsToTry = [];
    
    if (selectedModel === 'auto') {
      if (fetchedModels.length > 0) {
        const prioList = ['gemini-2.5-flash', 'gemini-2.0-flash-exp', 'gemini-2.0-flash', 'gemini-1.5-pro-latest', 'gemini-1.5-pro', 'gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-3.6-flash'];
        modelsToTry = prioList.filter(m => fetchedModels.includes(m));
        if(modelsToTry.length === 0) modelsToTry = [fetchedModels[0]]; 
      } else {
        modelsToTry = ['gemini-1.5-pro-latest', 'gemini-1.5-flash-latest', 'gemini-1.5-pro', 'gemini-1.5-flash'];
      }
    } else {
      modelsToTry = [selectedModel]; 
    }

    let uploadedFileRef = null;
    if (fileBlob) {
      statusEl.innerText = "⏳ Laddar upp filen säkert till Google (2GB-stöd)...";
      uploadedFileRef = await uploadToGeminiFileAPI(fileBlob, GEMINI_API_KEY);
      statusEl.innerText = "⏳ AI lyssnar och transkriberar...";
    }

    let data = null;
    let lastErrorMessage = "";

    for (const model of modelsToTry) {
      try {
        console.log(`Testar modell: ${model}`);
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        let requestBody = textData 
          ? { contents: [{ parts: [{ text: prompt + textData }] }] }
          : { contents: [{ parts: [{ text: prompt }, { fileData: { mimeType: uploadedFileRef.mimeType, fileUri: uploadedFileRef.fileUri } }] }] };

        let response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || `HTTP error ${response.status}`);
        }

        data = await response.json();
        break; 

      } catch (err) {
        lastErrorMessage = err.message;
      }
    }

    if (!data) throw new Error(`Google nekade åtkomst med din nyckel. Felet: ${lastErrorMessage}`);
    if (!data.candidates || data.candidates.length === 0) throw new Error("Fick inget svar från AI.");

    let aiText = data.candidates[0].content.parts[0].text;
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) aiText = jsonMatch[0];
    else aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    const resultObj = JSON.parse(aiText);
    
    clearInterval(progressInterval);
    progressBar.style.width = '100%';
    progressText.innerText = '100%';

    // Spara en kopia av rå-transkriptionen för snabb-genereringar
    window.currentRawTranscript = resultObj.transcript.map(item => `${item.speaker}: ${item.text}`).join('\n');

    setTimeout(() => {
      overlay.style.display = 'none';
      renderResult(resultObj);
      showTab('result'); // Växlar vyn över till resultatet snyggt och prydligt!
    }, 500);

  } catch (error) {
    triggerError(error.message);
  }
}

function triggerError(msg) {
  clearInterval(progressInterval);
  const errorBox = document.getElementById('errorBox');
  document.getElementById('status').innerText = "Något gick fel.";
  errorBox.innerHTML = `<strong>Fel:</strong> ${msg}`;
  errorBox.style.display = 'block';
  document.getElementById('closeErrorBtn').style.display = 'block';
}

function renderResult(data) {
  const resultEl = document.getElementById('result');

  // SKRÄDDARSY SAMMANFATTNING (Dynamisk snabbmeny högst upp)
  let html = `
    <div style="background:#f8fafc; padding:20px; border-radius:12px; margin-bottom:20px; border:1px solid #cbd5e1; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
      <h3 style="margin-top:0; font-size:1.1rem; color:var(--primary); display:flex; align-items:center; gap:8px;">⚙️ Ändra Sammanfattning</h3>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 15px;">Inte nöjd? Generera en ny på 2 sekunder utan att ladda upp filen igen!</p>
      
      <div style="display: flex; gap: 15px; margin-bottom: 15px; font-size: 0.95rem; font-weight:bold;">
        <label style="display:flex; align-items:center; gap:5px;"><input type="radio" name="resumLength" value="kort"> Kort</label>
        <label style="display:flex; align-items:center; gap:5px;"><input type="radio" name="resumLength" value="mellan" checked> Mellan</label>
        <label style="display:flex; align-items:center; gap:5px;"><input type="radio" name="resumLength" value="lång"> Lång</label>
      </div>
      
      <input type="text" id="resumFocus" placeholder="Fokus (t.ex. 'endast budget')" style="margin-bottom:15px;">
      <button id="resumBtn" class="btn-primary" style="margin-top:0; padding:12px; box-shadow:none;">🔄 Uppdatera sammanfattning</button>
    </div>
  `;

  html += `<h2>📋 Sammanfattning</h2><p id="summaryText" style="line-height:1.6; font-size:1.05rem;">${data.summary}</p>`;
  
  html += `<h2 style="margin-top:30px;">👥 Hantera Talare</h2><div class="speaker-controls" id="speakerControls">`;
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
    <div id="rawTranscriptData" style="display:none;">${encodeURIComponent(window.currentRawTranscript)}</div>
  `;

  resultEl.innerHTML = html;
  
  // Spara HTML i localstorage så vi inte tappar bort det om sidan stängs
  localStorage.setItem('currentDraftHTML', html);
  
  setupResultInteractivity();
  saveToHistory(html);
}

// 2. MAGISK FUNKTION: UPDATERA SAMMANFATTNING UTAN ATT LADDA UPP IGEN!
async function handleResummarize() {
  const btn = document.getElementById('resumBtn');
  btn.innerText = "⏳ Skapar...";
  btn.disabled = true;
  
  try {
    const apiKey = localStorage.getItem('geminiApiKey');
    const length = document.querySelector('input[name="resumLength"]:checked').value;
    const focus = document.getElementById('resumFocus').value.trim();
    const rawData = window.currentRawTranscript;
    
    if(!rawData) throw new Error("Kunde inte hitta transkriptionen i minnet.");
    
    let prompt = `Du är en expert på att sammanfatta text. Skriv en ${length} sammanfattning av följande konversation. ${focus ? 'Du MÅSTE fokusera särskilt på: ' + focus + '.' : ''} Returnera BARA sammanfattningstexten rakt upp och ner, använd ingen inledning, avslutning eller kodblockering.\n\nKONVERSATION:\n${rawData}`;
    
    // Vi använder alltid flash för text-sammanfattning eftersom den är snabbast och vi redan har texten
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    
    if(!res.ok) throw new Error("API fel under uppdatering.");
    const data = await res.json();
    const newSummary = data.candidates[0].content.parts[0].text.trim();
    
    // Byt ut texten på skärmen
    document.getElementById('summaryText').innerText = newSummary;
    
    // Spara det nya resultatet permanent
    localStorage.setItem('currentDraftHTML', document.getElementById('result').innerHTML);
    
  } catch(e) {
    alert("Fel vid uppdatering: " + e.message);
  } finally {
    btn.innerText = "🔄 Uppdatera sammanfattning";
    btn.disabled = false;
  }
}

function setupResultInteractivity() {
  
  const resumBtn = document.getElementById('resumBtn');
  if (resumBtn) {
    // Klonar för att undvika dubbla klick-lyssnare om metoden körs flera gånger
    const newResumBtn = resumBtn.cloneNode(true);
    resumBtn.parentNode.replaceChild(newResumBtn, resumBtn);
    newResumBtn.addEventListener('click', handleResummarize);
  }

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
      localStorage.setItem('currentDraftHTML', document.getElementById('result').innerHTML);
    });
  });
  
  document.querySelectorAll('.speaker-color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const speakerId = e.target.getAttribute('data-speaker');
      const chosenColor = e.target.style.backgroundColor;
      document.querySelectorAll(`.transcript-line[data-speaker="${speakerId}"]`).forEach(line => {
        line.style.backgroundColor = chosenColor;
      });
      localStorage.setItem('currentDraftHTML', document.getElementById('result').innerHTML);
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
        `<p style="margin-bottom:8px;"><strong>${line.querySelector('.speaker-label').innerText}:</strong><br> ${line.querySelector('span[contenteditable]').innerText}</p>`
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
  const resumControls = document.querySelector('.summary-controls') || document.querySelector('h3').parentNode; 
  if(exportContainer) exportContainer.style.display = 'none';
  if(resumControls && resumControls.tagName === 'DIV') resumControls.style.display = 'none'; // Göm ändra-rutan på PDF
  
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
    if(exportContainer) exportContainer.style.display = 'grid';
    if(resumControls) resumControls.style.display = 'block';
    return;
  }

  html2pdf().set(opt).from(element).save().then(() => {
    if(exportContainer) exportContainer.style.display = 'block';
    if(resumControls) resumControls.style.display = 'block';
  });
}
