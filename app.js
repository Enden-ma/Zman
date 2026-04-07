/* === GLOBAL DOM & STATE === */
const appSwitcher = document.getElementById('app-switcher'); const btnAvoda = document.getElementById('btn-switch-avoda'); const btnNeshima = document.getElementById('btn-switch-neshima');
const appAvoda = document.getElementById('app-avoda'); const appNeshima = document.getElementById('app-neshima');
const delay = ms => new Promise(res => setTimeout(res, ms));

const FOCUS_COLOR_1 = '#FFCDD2'; const FOCUS_COLOR_2 = '#81D4FA'; const BREAK_COLOR_1 = '#A8E6CF'; const BREAK_COLOR_2 = '#E4C95A'; const COLOR_BLUE = '#81D4FA'; const COLOR_GREEN = '#A8E6CF';

const appState = {
    wakeLock: null,
    audioUnlocked: false
};

/* === THEME COLOR SYNC ENGINE === */
const metaThemeColor = document.querySelector('meta[name="theme-color"]');
let themeSyncStartTime = 0; let themeSyncReqId;
function rgbToHex(rgb) {
    const matches = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!matches) return rgb;
    return "#" + matches.slice(1, 4).map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
}
function syncThemeColorFrame() {
    if (!metaThemeColor) return;
    const currentBg = window.getComputedStyle(document.body).backgroundColor;
    metaThemeColor.setAttribute('content', rgbToHex(currentBg));
    if (Date.now() - themeSyncStartTime < 1550) themeSyncReqId = requestAnimationFrame(syncThemeColorFrame);
}
new MutationObserver(() => {
    themeSyncStartTime = Date.now(); cancelAnimationFrame(themeSyncReqId); themeSyncReqId = requestAnimationFrame(syncThemeColorFrame);
}).observe(document.body, { attributes: true, attributeFilter: ['style'] });

/* === WAKE LOCK RESTORE === */
async function requestWakeLock() { try { if ('wakeLock' in navigator) appState.wakeLock = await navigator.wakeLock.request('screen'); } catch (err) { } }
function releaseWakeLock() { if (appState.wakeLock !== null) { appState.wakeLock.release(); appState.wakeLock = null; } }

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (avoda.running || neshima.running || neshima.postRunning)) {
        requestWakeLock();
    }
});

function toggleSwitcherVisibility(hide) { appSwitcher.style.opacity = hide ? '0' : '1'; appSwitcher.style.pointerEvents = hide ? 'none' : 'auto'; }

/* === APP SWITCHING === */
btnAvoda.addEventListener('click', () => {
    if (btnAvoda.classList.contains('active')) return;
    if (neshima.running || neshima.postRunning) neshimaStopTimer();
    btnAvoda.classList.add('active'); btnNeshima.classList.remove('active');
    appNeshima.classList.remove('active'); appAvoda.classList.add('active'); document.body.style.backgroundColor = FOCUS_COLOR_1;
});

btnNeshima.addEventListener('click', () => {
    if (btnNeshima.classList.contains('active')) return;
    if (avoda.running) avodaResetTimer();
    btnNeshima.classList.add('active'); btnAvoda.classList.remove('active');
    appAvoda.classList.remove('active'); appNeshima.classList.add('active'); document.body.style.backgroundColor = COLOR_BLUE;
});

/* === AUDIO COMPRESSION ENGINE === */
let audioCtx; let masterCompressor;
const silentAudioWav = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
const iosUnlocker = new Audio(silentAudioWav); iosUnlocker.loop = false;

function unlockAudioCtx() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterCompressor = audioCtx.createDynamicsCompressor();
        masterCompressor.threshold.value = -15; masterCompressor.knee.value = 30; masterCompressor.ratio.value = 12;
        masterCompressor.attack.value = 0.003; masterCompressor.release.value = 0.25;
        masterCompressor.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!appState.audioUnlocked) {
        iosUnlocker.play().then(() => appState.audioUnlocked = true).catch(e => { });
        const buffer = audioCtx.createBuffer(1, 1, 22050); const source = audioCtx.createBufferSource();
        source.buffer = buffer; source.connect(audioCtx.destination); source.start(0);
        appState.audioUnlocked = true;
    }
}

function createPinkNoiseBuffer(context) {
    const bufferSize = context.sampleRate * 5; const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = buffer.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1; b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520; b3 = 0.86650 * b3 + white * 0.3104856; b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980; output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362; output[i] *= 0.11; b6 = white * 0.115926;
    } return buffer;
}

/* =========================================
   ZMAN AVODA LOGIC 
   ========================================= */
const avoda = {
    running: false, paused: false, reqId: null, hintInterval: null, hintIdx: 0,
    end: 0, duration: 0, realStart: 0, msLeft: 0, isFocus: true, lastDisplay: "",
    phaseStr: "", c1: '', c2: '', isC1: true,
    inhale: 5.5, exhale: 5.5, softnoiseOn: false,
    audioSrc: null, audioFilter: null, audioGain: null
};

const circMain = 879.64; const circMin = 804.24;
const avodaHints = ["inhale and exhale<br>with the circle", "it will help<br>you focus", "keep it up :)"];

const mainRing = document.getElementById('main-ring'); const minRing = document.getElementById('min-ring');
const ringWrapper = document.getElementById('ring-wrapper'); const textWrapper = document.getElementById('text-wrapper');
const colonEl = document.getElementById('colon'); const avodaStartBtn = document.getElementById('avoda-startBtn'); const avodaResetBtn = document.getElementById('avoda-resetBtn');
const avodaControls = document.getElementById('avoda-controls'); const avodaTimerVisual = document.getElementById('avoda-timerVisual');
const focusInput = document.getElementById('focusInput'); const breakInput = document.getElementById('breakInput');
const transitionScreen = document.getElementById('transitionScreen'); const nextPhaseBtn = document.getElementById('nextPhaseBtn'); const endSessionBtn = document.getElementById('endSessionBtn');

document.querySelectorAll('.preset-btn-avoda').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.preset-btn-avoda').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        avoda.inhale = parseFloat(e.currentTarget.dataset.inhale); avoda.exhale = parseFloat(e.currentTarget.dataset.exhale);
    });
});

function startAvodaHintLoop() {
    clearInterval(avoda.hintInterval); avoda.hintIdx = 0;
    const hintEl = document.getElementById('avoda-hint-text'); hintEl.innerHTML = avodaHints[0]; hintEl.style.opacity = 1;
    avoda.hintInterval = setInterval(() => {
        hintEl.style.opacity = 0;
        setTimeout(() => {
            if (!avoda.running) return;
            avoda.hintIdx = (avoda.hintIdx + 1) % avodaHints.length;
            hintEl.innerHTML = avodaHints[avoda.hintIdx]; hintEl.style.opacity = 1;
        }, 500);
    }, (avoda.inhale + avoda.exhale) * 1000);
}

function playStartBeep() {
    unlockAudioCtx();
    for (let i = 0; i < 3; i++) {
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = 261; const startTime = audioCtx.currentTime + (i * 0.08);
        gain.gain.setValueAtTime(0, startTime); gain.gain.linearRampToValueAtTime(1, startTime + 0.01); gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07);
        osc.connect(gain); gain.connect(masterCompressor); osc.start(startTime); osc.stop(startTime + 0.08);
    }
}

function playEndChime() {
    unlockAudioCtx(); const interval = 1 / 10;
    for (let i = 0; i < 5; i++) {
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = 329; const startTime = audioCtx.currentTime + (i * interval);
        gain.gain.setValueAtTime(0, startTime); gain.gain.linearRampToValueAtTime(1, startTime + 0.01); gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.09);
        osc.connect(gain); gain.connect(masterCompressor); osc.start(startTime); osc.stop(startTime + 0.1);
    }
}

function startAvodaSoftnoise() {
    unlockAudioCtx(); stopAvodaSoftnoise();
    avoda.audioSrc = audioCtx.createBufferSource(); avoda.audioSrc.buffer = createPinkNoiseBuffer(audioCtx); avoda.audioSrc.loop = true;
    avoda.audioFilter = audioCtx.createBiquadFilter(); avoda.audioFilter.type = 'bandpass'; avoda.audioFilter.frequency.value = 350; avoda.audioFilter.Q.value = 0.6;
    avoda.audioGain = audioCtx.createGain(); avoda.audioGain.gain.value = 0.08;
    avoda.audioSrc.connect(avoda.audioFilter); avoda.audioFilter.connect(avoda.audioGain); avoda.audioGain.connect(masterCompressor); avoda.audioSrc.start();
}

function stopAvodaSoftnoise() { if (avoda.audioSrc) { try { avoda.audioSrc.stop(); } catch (e) { } avoda.audioSrc.disconnect(); avoda.audioSrc = null; } }

document.getElementById('avodaSoftnoiseToggle').addEventListener('click', (e) => {
    unlockAudioCtx(); avoda.softnoiseOn = !avoda.softnoiseOn; e.target.classList.toggle('active', avoda.softnoiseOn);
    if (avoda.running && !avoda.paused) { if (avoda.softnoiseOn) startAvodaSoftnoise(); else stopAvodaSoftnoise(); }
});

function avodaUpdateDisplayTick(strVal) {
    if (strVal === avoda.lastDisplay) return;
    const oldChars = avoda.lastDisplay.split(''); const newChars = strVal.split('');
    const digitIds = ['digit-m1', 'digit-m2', 'colon', 'digit-s1', 'digit-s2'];
    for (let i = 0; i < 5; i++) {
        if (i === 2) continue;
        if (oldChars[i] !== newChars[i] || avoda.lastDisplay === "") {
            const el = document.getElementById(digitIds[i]); el.classList.add('fade-out-tick');
            setTimeout(() => { el.innerText = newChars[i]; el.classList.remove('fade-out-tick'); }, 300);
        }
    } avoda.lastDisplay = strVal;
}

function avodaSetPhase(isFocus) {
    avoda.isFocus = isFocus; avoda.realStart = Date.now();
    const rawVal = parseFloat(isFocus ? focusInput.value : breakInput.value); const minutes = (isNaN(rawVal) || rawVal <= 0) ? 1 : rawVal;
    avoda.duration = Math.floor(minutes * 60000); avoda.end = Date.now() + avoda.duration;

    colonEl.classList.remove('colon-pulse'); void colonEl.offsetWidth; colonEl.classList.add('colon-pulse');

    avoda.c1 = avoda.isFocus ? FOCUS_COLOR_1 : BREAK_COLOR_1; avoda.c2 = avoda.isFocus ? FOCUS_COLOR_2 : BREAK_COLOR_2;
    avoda.isC1 = true; avoda.phaseStr = "inhale"; document.body.style.backgroundColor = avoda.c1;

    if (avoda.softnoiseOn) startAvodaSoftnoise(); playStartBeep(); startAvodaHintLoop();
}

function avodaRunEngine() {
    if (!avoda.running || avoda.paused) return;
    const now = Date.now(); let msLeft = avoda.end - now;
    if (msLeft <= 0) {
        cancelAnimationFrame(avoda.reqId); clearInterval(avoda.hintInterval);
        avoda.running = false; stopAvodaSoftnoise(); playEndChime(); releaseWakeLock();
        avodaTimerVisual.style.display = 'none'; avodaResetBtn.style.display = 'none'; transitionScreen.style.display = 'flex';
        nextPhaseBtn.innerHTML = avoda.isFocus ? "Start<br>Break" : "Work"; toggleSwitcherVisibility(false); return;
    }
    const mins = Math.floor(Math.ceil(msLeft / 1000) / 60); const secs = Math.ceil(msLeft / 1000) % 60;
    avodaUpdateDisplayTick(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    mainRing.style.strokeDashoffset = circMain - ((msLeft / avoda.duration) * circMain);
    minRing.style.strokeDashoffset = circMin - (((msLeft % 60000) / 60000) * circMin);

    const cycleDuration = (avoda.inhale + avoda.exhale) * 1000;
    const cycleTime = (now - avoda.realStart) % cycleDuration;
    const isAvodaInhalePhase = cycleTime < (avoda.inhale * 1000);

    const newPhaseStr = isAvodaInhalePhase ? "inhale" : "exhale";
    if (avoda.phaseStr !== newPhaseStr) {
        avoda.phaseStr = newPhaseStr;
        avoda.isC1 = !avoda.isC1; document.body.style.backgroundColor = avoda.isC1 ? avoda.c1 : avoda.c2;
    }

    let progress = isAvodaInhalePhase ? cycleTime / (avoda.inhale * 1000) : (cycleTime - avoda.inhale * 1000) / (avoda.exhale * 1000);
    const ease = (t) => 0.5 - Math.cos(t * Math.PI) / 2;
    const e = ease(progress);

    const ringScale = isAvodaInhalePhase ? 0.9 + (e * 0.2) : 1.1 - (e * 0.2);
    const textOp = isAvodaInhalePhase ? 0.15 + (e * 0.85) : 1.0 - (e * 0.85);
    const textSc = isAvodaInhalePhase ? 0.95 + (e * 0.1) : 1.05 - (e * 0.1);
    const hintY = isAvodaInhalePhase ? -2 + (e * 4) : 2 - (e * 4);

    ringWrapper.style.transform = `scale(${ringScale})`;
    textWrapper.style.opacity = textOp;
    textWrapper.style.transform = `scale(${textSc})`; // Prevents text jitter
    document.getElementById('avoda-hint-text').style.transform = `translateY(${hintY}px)`;

    if (avoda.softnoiseOn && avoda.audioFilter && avoda.audioGain) {
        const currentFreq = isAvodaInhalePhase ? 350 + (e * 250) : 600 - (e * 250);
        const currentVol = isAvodaInhalePhase ? 0.06 + (e * 0.04) : 0.10 - (e * 0.04);
        avoda.audioFilter.frequency.setTargetAtTime(currentFreq, audioCtx.currentTime, 0.05);
        avoda.audioGain.gain.setTargetAtTime(currentVol, audioCtx.currentTime, 0.05);
    }

    avoda.reqId = requestAnimationFrame(avodaRunEngine);
}

avodaTimerVisual.addEventListener('click', () => {
    if (!avoda.running) return; unlockAudioCtx();
    if (avoda.paused) {
        avoda.paused = false; avoda.end = Date.now() + avoda.msLeft;
        avoda.reqId = requestAnimationFrame(avodaRunEngine);
        avodaTimerVisual.classList.remove('is-paused'); colonEl.style.animationPlayState = 'running';
        if (avoda.softnoiseOn) startAvodaSoftnoise(); requestWakeLock(); startAvodaHintLoop();
    } else {
        avoda.paused = true; cancelAnimationFrame(avoda.reqId); clearInterval(avoda.hintInterval); avoda.msLeft = avoda.end - Date.now();
        avodaTimerVisual.classList.add('is-paused'); colonEl.style.animationPlayState = 'paused';
        stopAvodaSoftnoise(); releaseWakeLock();
    }
});

function avodaResetTimer() {
    avoda.running = false; avoda.paused = false; cancelAnimationFrame(avoda.reqId); clearInterval(avoda.hintInterval);
    stopAvodaSoftnoise(); releaseWakeLock();
    avodaTimerVisual.classList.remove('is-paused'); colonEl.style.animationPlayState = 'running';

    ringWrapper.style.transform = `scale(1)`; textWrapper.style.opacity = 1; textWrapper.style.transform = `scale(1)`; document.getElementById('avoda-hint-text').style.transform = `translateY(-2px)`;

    avodaTimerVisual.style.display = 'none'; avodaResetBtn.style.display = 'none'; transitionScreen.style.display = 'none';
    avodaControls.style.display = 'flex'; document.body.style.backgroundColor = FOCUS_COLOR_1; toggleSwitcherVisibility(false);
}

function startAvodaFlow(isFocus) {
    unlockAudioCtx(); requestWakeLock(); toggleSwitcherVisibility(true);
    avodaControls.style.display = 'none'; transitionScreen.style.display = 'none'; avodaTimerVisual.style.display = 'flex'; avodaResetBtn.style.display = 'block';
    avoda.running = true; avoda.paused = false; avoda.lastDisplay = ""; avodaSetPhase(isFocus);
    avoda.reqId = requestAnimationFrame(avodaRunEngine);
}

avodaStartBtn.addEventListener('click', () => startAvodaFlow(true)); nextPhaseBtn.addEventListener('click', () => startAvodaFlow(!avoda.isFocus));
avodaResetBtn.addEventListener('click', avodaResetTimer); endSessionBtn.addEventListener('click', avodaResetTimer);


/* =========================================
   ZMAN NESHIMA LOGIC & CINEMATIC SEQUENCE
   ========================================= */
const neshima = {
    running: false, postRunning: false, reqId: null, cineReqId: null,
    seq: [], idx: 0, stepEnd: 0, sessionEnd: 0, useSession: false,
    targetCyc: 0, compCyc: 0, useCycLimit: false, limitWait: false,
    isBlue: true, lastDisplay: "", updateId: 0,
    headstart: true, minLimit: true, softnoiseOn: false,
    audioSrc: null, audioFilter: null, audioGain: null,
    cineIdx: 0, cineEnd: 0, resetListener: null
};

function playNeshimaBeep(type) {
    unlockAudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    let freq = 396;
    if (type === 'restart') freq = 432;
    if (type === 'done') freq = 285;

    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);

    osc.type = 'sine'; osc.frequency.value = freq;

    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.98, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.start(now); osc.stop(now + 0.15);
}

const neshimaRing = document.getElementById('neshima-ring'); const neshimaDisplay = document.getElementById('neshima-display'); const neshimaSvg = document.getElementById('neshima-svg');
const neshimaStartBtn = document.getElementById('neshima-startBtn'); const neshimaStopBtn = document.getElementById('neshima-stopBtn');
const neshimaControls = document.getElementById('neshima-controls'); const neshimaTimerVisual = document.getElementById('neshima-timerVisual');
const sequenceInput = document.getElementById('sequence'); const limitInput = document.getElementById('limitInput');
const headToggle = document.getElementById('headstartToggle'); const limitToggle = document.getElementById('limitToggle'); const neshimaSoftnoiseToggle = document.getElementById('neshimaSoftnoiseToggle');
const statsContainer = document.getElementById('neshima-stats'); const statCycles = document.getElementById('stat-cycles'); const statRemaining = document.getElementById('stat-remaining');
const neshimaPostBtn = document.getElementById('neshima-post-btn');

headToggle.addEventListener('click', () => { neshima.headstart = !neshima.headstart; headToggle.classList.toggle('active', neshima.headstart); });

const triggerSmoothToggle = (toMinutes) => {
    if (toMinutes && !neshima.minLimit) {
        limitToggle.classList.add('fade-out-toggle');
        setTimeout(() => { neshima.minLimit = true; limitToggle.innerText = 'minutes'; limitToggle.classList.remove('fade-out-toggle'); }, 400);
    } else if (!toMinutes && neshima.minLimit) {
        limitToggle.classList.add('fade-out-toggle');
        setTimeout(() => { neshima.minLimit = false; limitToggle.innerText = 'cycles'; limitToggle.classList.remove('fade-out-toggle'); }, 400);
    }
};

limitToggle.addEventListener('click', () => triggerSmoothToggle(!neshima.minLimit));

neshimaSoftnoiseToggle.addEventListener('click', () => { unlockAudioCtx(); neshima.softnoiseOn = !neshima.softnoiseOn; neshimaSoftnoiseToggle.classList.toggle('active', neshima.softnoiseOn); if (neshima.running) { if (neshima.softnoiseOn) startNeshimaSoftnoise(); else stopNeshimaSoftnoise(); } });

document.querySelectorAll('#neshima-controls .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        sequenceInput.classList.add('crossfade-out'); limitInput.classList.add('crossfade-out');
        setTimeout(() => {
            sequenceInput.value = btn.dataset.seq;
            if (btn.dataset.limit) { limitInput.value = btn.dataset.limit; triggerSmoothToggle(btn.dataset.limittype === 'minutes'); }
            else { limitInput.value = ""; triggerSmoothToggle(true); }
            setTimeout(() => { sequenceInput.classList.remove('crossfade-out'); limitInput.classList.remove('crossfade-out'); }, 20);
        }, 400);
    });
});

function startNeshimaSoftnoise() {
    if (!audioCtx) unlockAudioCtx(); stopNeshimaSoftnoise();
    neshima.audioSrc = audioCtx.createBufferSource(); neshima.audioSrc.buffer = createPinkNoiseBuffer(audioCtx); neshima.audioSrc.loop = true;
    neshima.audioFilter = audioCtx.createBiquadFilter(); neshima.audioFilter.type = 'bandpass'; neshima.audioFilter.frequency.value = 250; neshima.audioFilter.Q.value = 0.8;
    neshima.audioGain = audioCtx.createGain(); neshima.audioGain.gain.value = 0.05;
    neshima.audioSrc.connect(neshima.audioFilter); neshima.audioFilter.connect(neshima.audioGain); neshima.audioGain.connect(masterCompressor); neshima.audioSrc.start();
}

function stopNeshimaSoftnoise() { if (neshima.audioSrc) { try { neshima.audioSrc.stop(); } catch (e) { } neshima.audioSrc.disconnect(); neshima.audioSrc = null; } }

function neshimaUpdateDisplay(val, forceUpdate = false) {
    const strVal = String(val);
    if (strVal === neshima.lastDisplay) return;
    neshima.lastDisplay = strVal;

    const currentId = ++neshima.updateId;
    neshimaDisplay.classList.add('fade-out');

    setTimeout(() => {
        if (neshima.updateId !== currentId) return;
        if (!forceUpdate && !neshima.running && !neshima.postRunning) return;

        neshimaDisplay.innerHTML = strVal;

        const lowerVal = strVal.toLowerCase();
        if (lowerVal === "finish" || lowerVal === "done") { neshimaDisplay.classList.add('text-done'); neshimaDisplay.classList.remove('text-cinematic'); }
        else if (strVal.includes("<br>") || strVal.includes("take")) { neshimaDisplay.classList.add('text-cinematic'); neshimaDisplay.classList.remove('text-done'); }
        else { neshimaDisplay.classList.remove('text-done'); neshimaDisplay.classList.remove('text-cinematic'); }

        neshimaDisplay.classList.remove('fade-out');
    }, 150);
}

function updateNeshimaHUD() {
    statCycles.innerText = `Cycles: ${neshima.compCyc}`;
    if (neshima.useCycLimit) { statRemaining.innerText = `${Math.max(0, neshima.targetCyc - neshima.compCyc)} left`; }
    else if (neshima.useSession) { statRemaining.innerText = `${Math.ceil(Math.max(0, neshima.sessionEnd - Date.now()) / 60000)} min left`; }
}

function playCompletionChime() { playNeshimaBeep('done'); setTimeout(() => playNeshimaBeep('done'), 333); setTimeout(() => playNeshimaBeep('done'), 666); }

function neshimaRunEngine() {
    if (!neshima.running) return; const now = Date.now();
    if (neshima.useSession && now >= neshima.sessionEnd) { neshima.limitWait = true; }
    let timeLeft = neshima.stepEnd - now;

    if (timeLeft <= 0) {
        neshima.idx = (neshima.idx + 1) % neshima.seq.length; const isCycleRestart = (neshima.idx === 0);
        if (isCycleRestart) { neshima.compCyc++; updateNeshimaHUD(); if ((neshima.useCycLimit && neshima.compCyc >= neshima.targetCyc) || neshima.limitWait) { neshimaEndSession(); return; } }
        playNeshimaBeep(isCycleRestart ? 'restart' : 'step'); neshima.isBlue = !neshima.isBlue; document.body.style.backgroundColor = neshima.isBlue ? COLOR_BLUE : COLOR_GREEN;
        neshima.stepEnd += (neshima.seq[neshima.idx] * 1000); timeLeft = neshima.stepEnd - now;
    }

    const currentStepDuration = neshima.seq[neshima.idx] * 1000;
    let currentBeat = Math.max(1, Math.ceil(timeLeft / 1000)); neshimaUpdateDisplay(currentBeat);
    const percentage = Math.max(0, timeLeft) / currentStepDuration; neshimaRing.style.transform = `rotate(${-(percentage * 360)}deg)`;

    let phaseType = 'hold';
    if (neshima.seq.length === 2) { phaseType = neshima.idx === 0 ? 'inhale' : 'exhale'; }
    else if (neshima.seq.length === 3) { phaseType = neshima.idx === 0 ? 'inhale' : (neshima.idx === 1 ? 'hold-high' : 'exhale'); }
    else if (neshima.seq.length >= 4) { phaseType = neshima.idx === 0 ? 'inhale' : (neshima.idx === 1 ? 'hold-high' : (neshima.idx === 2 ? 'exhale' : 'hold-low')); }

    const progress = 1 - percentage; const maxRingScale = 1.15; const minRingScale = 0.88; const maxTextScale = 1.08; const minTextScale = 0.92; let ringScale = 1, textScale = 1;

    if (phaseType === 'inhale') { ringScale = minRingScale + (progress * (maxRingScale - minRingScale)); textScale = minTextScale + (progress * (maxTextScale - minTextScale)); }
    else if (phaseType === 'exhale') { ringScale = maxRingScale - (progress * (maxRingScale - minRingScale)); textScale = maxTextScale - (progress * (maxTextScale - minTextScale)); }
    else if (phaseType === 'hold-high') { ringScale = maxRingScale; textScale = maxTextScale; }
    else if (phaseType === 'hold-low') { ringScale = minRingScale; textScale = minTextScale; }

    window.lastNeshimaTextScale = textScale;
    neshimaSvg.style.transform = `rotate(-90deg) scale(${ringScale})`; neshimaDisplay.style.transform = `scale(${textScale})`;

    if (neshima.softnoiseOn && neshima.audioFilter && neshima.audioGain) {
        const minFreq = 250; const maxFreq = 800; const minVol = 0.02; const maxVol = 0.1; let currentFreq = minFreq; let currentVol = minVol;
        if (phaseType === 'inhale') { currentFreq = minFreq + (progress * (maxFreq - minFreq)); currentVol = minVol + (progress * (maxVol - minVol)); }
        else if (phaseType === 'exhale') { currentFreq = maxFreq - (progress * (maxFreq - minFreq)); currentVol = maxVol - (progress * (maxVol - minVol)); }
        else if (phaseType === 'hold-high') { currentFreq = maxFreq; currentVol = maxVol; }
        else if (phaseType === 'hold-low') { currentFreq = minFreq; currentVol = minVol; }
        neshima.audioFilter.frequency.setTargetAtTime(currentFreq, audioCtx.currentTime, 0.03); neshima.audioGain.gain.setTargetAtTime(currentVol, audioCtx.currentTime, 0.03);
    }

    neshima.reqId = requestAnimationFrame(neshimaRunEngine);
}

function neshimaEndSession() {
    playCompletionChime(); neshima.running = false; cancelAnimationFrame(neshima.reqId); releaseWakeLock(); stopNeshimaSoftnoise();
    neshimaRing.style.transform = `rotate(0deg)`;
    neshimaStopBtn.style.display = 'block'; neshimaStopBtn.innerText = "Finish"; neshimaPostBtn.style.display = 'block';
    document.getElementById('neshima-stats').style.display = 'none'; toggleSwitcherVisibility(false);
    neshimaSvg.style.transform = `rotate(-90deg) scale(1)`; window.lastNeshimaTextScale = 1; neshimaDisplay.style.transform = `scale(1)`;
    neshimaUpdateDisplay("Done", true);
}

function neshimaStopTimer() {
    neshima.running = false; neshima.postRunning = false; cancelAnimationFrame(neshima.reqId); cancelAnimationFrame(neshima.cineReqId);
    releaseWakeLock(); stopNeshimaSoftnoise();
    if (neshima.resetListener) { document.removeEventListener('click', neshima.resetListener); neshima.resetListener = null; }

    neshimaTimerVisual.style.display = 'none'; neshimaStopBtn.style.display = 'none'; neshimaPostBtn.style.display = 'none';
    neshimaControls.style.display = 'flex'; document.body.style.backgroundColor = COLOR_BLUE;

    neshima.lastDisplay = ""; toggleSwitcherVisibility(false);
    neshimaRing.style.transform = `rotate(0deg)`; neshimaRing.style.strokeDasharray = "32 750"; neshimaRing.style.strokeDashoffset = 16;

    neshimaSvg.style.transition = "none"; neshimaDisplay.style.transition = "opacity 0.2s ease";
    neshimaSvg.style.transform = `rotate(-90deg) scale(1)`; window.lastNeshimaTextScale = 1; neshimaDisplay.style.transform = `scale(1)`;

    document.getElementById('neshima-stats').style.display = 'none';
}

neshimaStartBtn.addEventListener('click', () => {
    if (!appState.audioUnlocked) { unlockAudioCtx(); appState.audioUnlocked = true; }

    neshima.seq = sequenceInput.value.split('-').map(num => parseFloat(num.trim())).filter(num => !isNaN(num) && num > 0); if (neshima.seq.length === 0) return;
    const limitVal = parseFloat(limitInput.value); neshima.useSession = false; neshima.useCycLimit = false; neshima.compCyc = 0; neshima.limitWait = false;
    if (!isNaN(limitVal) && limitVal > 0) { if (neshima.minLimit) { neshima.sessionEnd = Date.now() + (limitVal * 60000); neshima.useSession = true; } else { neshima.targetCyc = limitVal; neshima.useCycLimit = true; } }

    const statsEl = document.getElementById('neshima-stats'); statsEl.style.display = 'flex';
    if (!neshima.useSession && !neshima.useCycLimit) { statsEl.style.justifyContent = 'center'; statRemaining.style.display = 'none'; }
    else { statsEl.style.justifyContent = 'space-between'; statRemaining.style.display = 'block'; }
    updateNeshimaHUD();

    requestWakeLock(); toggleSwitcherVisibility(true); neshimaControls.style.display = 'none'; neshimaTimerVisual.style.display = 'block';
    neshimaStopBtn.style.display = 'block'; neshimaStopBtn.innerText = "Stop"; neshimaPostBtn.style.display = 'none';
    neshima.running = true; neshima.isBlue = true; document.body.style.backgroundColor = COLOR_BLUE;

    neshima.lastDisplay = ""; neshimaSvg.style.transition = "none"; neshimaDisplay.style.transition = "opacity 0.2s ease";
    neshimaRing.style.strokeDasharray = "32 750"; neshimaRing.style.transform = `rotate(0deg)`;
    neshimaDisplay.innerText = neshima.headstart ? "3" : String(Math.ceil(neshima.seq[0]));

    if (neshima.softnoiseOn) startNeshimaSoftnoise();

    setTimeout(async () => {
        if (neshima.headstart) { for (let i = 3; i > 0; i--) { if (!neshima.running) return; neshimaUpdateDisplay(i); await delay(1000); } if (!neshima.running) return; }
        playNeshimaBeep('restart'); neshima.idx = 0; neshima.stepEnd = Date.now() + (neshima.seq[0] * 1000);
        neshima.reqId = requestAnimationFrame(neshimaRunEngine);
    }, 70);
});

neshimaStopBtn.addEventListener('click', neshimaStopTimer);

// --- THE POST-SESSION CINEMATIC ENGINE ---
const cinematicPhases = [
    { type: 'setup', text: "take a<br>deep one in", duration: 2500 },
    { type: 'inhale', text: "6s<br>inhale", duration: 6000 },
    { type: 'hold-high', text: "hold<br>for 15s", duration: 15000 },
    { type: 'exhale', text: "release<br>slowly", duration: 10000 },
    { type: 'hold-low', text: "hold<br>for 30s", duration: 30000 }
];

neshimaPostBtn.addEventListener('click', () => {
    neshimaPostBtn.style.display = 'none'; neshimaStopBtn.style.display = 'block'; neshimaStopBtn.innerText = "Stop";
    neshima.running = false; neshima.postRunning = true;
    neshimaSvg.style.transition = "none"; neshimaDisplay.style.transition = "opacity 0.2s ease";

    if (neshima.softnoiseOn && !neshima.audioSrc) startNeshimaSoftnoise();

    neshima.cineIdx = 0; neshima.cineEnd = Date.now() + cinematicPhases[0].duration;
    neshima.isBlue = true; document.body.style.backgroundColor = COLOR_BLUE;
    neshima.cineReqId = requestAnimationFrame(runCinematicEngine);
});

function runCinematicEngine() {
    if (!neshima.postRunning) return;
    const now = Date.now(); let timeLeft = neshima.cineEnd - now; let phase = cinematicPhases[neshima.cineIdx];

    if (timeLeft <= 0) {
        neshima.cineIdx++;
        if (neshima.cineIdx >= cinematicPhases.length) { endCinematicSequence(); return; }
        phase = cinematicPhases[neshima.cineIdx]; timeLeft = phase.duration; neshima.cineEnd = now + timeLeft;
        if (phase.type !== 'setup') { playNeshimaBeep('step'); neshima.isBlue = !neshima.isBlue; document.body.style.backgroundColor = neshima.isBlue ? COLOR_BLUE : COLOR_GREEN; }
    }

    const percentage = Math.max(0, timeLeft) / phase.duration; const progress = 1 - percentage;
    if (phase.type !== 'setup') neshimaRing.style.transform = `rotate(${-(percentage * 360)}deg)`;

    const timeElapsed = phase.duration - timeLeft;
    const isText = phase.type === 'setup' || timeElapsed < 3000;
    const displayStr = isText ? phase.text : String(Math.ceil(timeLeft / 1000));
    neshimaUpdateDisplay(displayStr, true);

    const maxRingScale = 1.15; const minRingScale = 0.88; const maxTextScale = 1.08; const minTextScale = 0.92; let ringScale = 1, textScale = 1;
    if (phase.type === 'setup') { ringScale = 1 - (progress * (1 - minRingScale)); textScale = 1 - (progress * (1 - minTextScale)); }
    else if (phase.type === 'inhale') { ringScale = minRingScale + (progress * (maxRingScale - minRingScale)); textScale = minTextScale + (progress * (maxTextScale - minTextScale)); }
    else if (phase.type === 'exhale') { ringScale = maxRingScale - (progress * (maxRingScale - minRingScale)); textScale = maxTextScale - (progress * (maxTextScale - minTextScale)); }
    else if (phase.type === 'hold-high') { ringScale = maxRingScale; textScale = maxTextScale; }
    else if (phase.type === 'hold-low') { ringScale = minRingScale; textScale = minTextScale; }

    window.lastNeshimaTextScale = textScale;
    neshimaSvg.style.transform = `rotate(-90deg) scale(${ringScale})`; neshimaDisplay.style.transform = `scale(${textScale})`;

    if (neshima.softnoiseOn && neshima.audioFilter) {
        const minFreq = 250; const maxFreq = 800; const minVol = 0.02; const maxVol = 0.1; let currentFreq = minFreq; let currentVol = minVol;
        if (phase.type === 'setup') { currentFreq = minFreq; currentVol = minVol; }
        else if (phase.type === 'inhale') { currentFreq = minFreq + (progress * (maxFreq - minFreq)); currentVol = minVol + (progress * (maxVol - minVol)); }
        else if (phase.type === 'exhale') { currentFreq = maxFreq - (progress * (maxFreq - minFreq)); currentVol = maxVol - (progress * (maxVol - minVol)); }
        else if (phase.type === 'hold-high') { currentFreq = maxFreq; currentVol = maxVol; }
        else if (phase.type === 'hold-low') { currentFreq = minFreq; currentVol = minVol; }
        neshima.audioFilter.frequency.setTargetAtTime(currentFreq, audioCtx.currentTime, 0.03); neshima.audioGain.gain.setTargetAtTime(currentVol, audioCtx.currentTime, 0.03);
    }

    neshima.cineReqId = requestAnimationFrame(runCinematicEngine);
}

function endCinematicSequence() {
    neshima.postRunning = false; cancelAnimationFrame(neshima.cineReqId); playCompletionChime(); stopNeshimaSoftnoise();

    neshimaRing.style.transform = `rotate(0deg)`; neshimaRing.style.strokeDasharray = "0 750";
    neshimaStopBtn.style.display = 'none';

    neshimaSvg.style.transition = "transform 2s ease-in-out"; neshimaDisplay.style.transition = "transform 2s ease-in-out, opacity 0.2s ease";
    neshimaSvg.style.transform = `rotate(-90deg) scale(1)`; window.lastNeshimaTextScale = 1; neshimaDisplay.style.transform = `scale(1)`;

    neshimaUpdateDisplay("Finish", true);

    setTimeout(() => {
        neshima.resetListener = () => { document.removeEventListener('click', neshima.resetListener); neshima.resetListener = null; neshimaStopTimer(); };
        document.addEventListener('click', neshima.resetListener);
    }, 300);
}