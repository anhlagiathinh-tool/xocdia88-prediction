import fastify from "fastify";
import cors from "@fastify/cors";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

// --- CẤU HÌNH ---
const PORT = 3000;
const API_URL = "https://taixiumd5.system32-cloudfare-356783752985678522.monster/api/md5luckydice/GetSoiCau";

// --- GLOBAL STATE ---
let txHistory = [];
let currentSessionId = null;
let fetchInterval = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- PATTERN DATABASE ĐẦY ĐỦ ---
const PATTERN_DATABASE = {
    // Cầu cơ bản
    '1-1': ['tx', 'xt'],
    'bệt': ['tt', 'xx'],
    '2-2': ['ttxx', 'xxtt'],
    '3-3': ['tttxxx', 'xxxttt'],
    '4-4': ['ttttxxxx', 'xxxxtttt'],
    
    // Cầu phức tạp
    '1-2-1': ['txxxt', 'xtttx'],
    '2-1-2': ['ttxtt', 'xxtxx'],
    '1-2-3': ['txxttt', 'xttxxx'],
    '3-2-3': ['tttxttt', 'xxxtxxx'],
    '4-2-4': ['ttttxxtttt', 'xxxxttxxxx'],
    '1-3-1': ['txtttx', 'xtxxxt'],
    
    // Cầu xen kẽ
    'zigzag': ['txt', 'xtx'],
    'double_zigzag': ['txtxt', 'xtxtx'],
    'triple_zigzag': ['txtxtxt', 'xtxtxtx'],
    
    // Cầu chu kỳ dài
    '1-1-1-2': ['txttx', 'xtxxt'],
    '2-1-1-1': ['ttxtx', 'xxtxt'],
    '1-2-2-2': ['txxxtt', 'xtttxx'],
    
    // Cầu hình học
    'triangle': ['txx', 'xtt'],
    'square': ['ttxx', 'xxtt'],
    'pentagon': ['tttxx', 'xxxtt'],
    
    // Cầu sóng
    'wave_2': ['ttxx', 'xxtt'],
    'wave_3': ['tttxxx', 'xxxttt'],
    'wave_4': ['ttttxxxx', 'xxxxtttt'],
    
    // Cầu đảo chiều
    'reverse_1': ['ttx', 'xxt'],
    'reverse_2': ['ttxx', 'xxtt'],
    'reverse_3': ['tttxxx', 'xxxttt'],
    
    // Cầu giao thoa
    'interlace_1': ['txtxt', 'xtxtx'],
    'interlace_2': ['ttxxtt', 'xxttxx'],
    
    // Cầu phân nhánh
    'branch_1': ['ttxtx', 'xxtxt'],
    'branch_2': ['ttxxttx', 'xxttxx'],
    
    // Cầu xoắn ốc
    'spiral_1': ['txxxt', 'xtttx'],
    'spiral_2': ['ttxxxtt', 'xxtttxx'],
    
    // Cầu đối xứng
    'symmetry_1': ['txt', 'xtx'],
    'symmetry_2': ['ttxxtt', 'xxttxx'],
    'symmetry_3': ['tttxxxttt', 'xxxxttxxx'],
    
    // Cầu lặp lại
    'repeat_1': ['tt', 'xx'],
    'repeat_2': ['tttt', 'xxxx'],
    'repeat_3': ['tttttt', 'xxxxxx'],
    
    // Cầu Fibonacci
    'fibonacci_1': ['t', 'x'],
    'fibonacci_2': ['tx', 'xt'],
    'fibonacci_3': ['txt', 'xtx'],
    'fibonacci_4': ['txttx', 'xtxxt'],
};

// --- STATS MANAGER ---
class StatsManager {
    constructor() {
        this.totalPredictions = 0;
        this.totalWins = 0;
        this.totalLosses = 0;
        this.predictionHistory = new Map();
    }

    recordPrediction(session, prediction) {
        this.predictionHistory.set(session, { 
            prediction, 
            actual: null,
            timestamp: Date.now() 
        });
    }

    recordOutcome(session, actual) {
        const record = this.predictionHistory.get(session);
        if (record && !record.actual) {
            record.actual = actual;
            if (record.prediction === actual) {
                this.totalWins++;
            } else {
                this.totalLosses++;
            }
            this.totalPredictions++;
        }
    }

    getStats() {
        const winRate = this.totalPredictions > 0 
            ? ((this.totalWins / this.totalPredictions) * 100).toFixed(2)
            : "0.00";
            
        return {
            total_predictions: this.totalPredictions,
            total_wins: this.totalWins,
            total_losses: this.totalLosses,
            win_rate: `${winRate}%`,
            active_patterns: this.predictionHistory.size
        };
    }
}

// --- UTILITIES ---
function parseLines(data) {
    if (!data || !Array.isArray(data)) return [];
    
    const sortedList = data.sort((a, b) => b.SessionId - a.SessionId);
    
    const arr = sortedList.map(item => {
        const total = item.DiceSum;
        const txLabel = total >= 11 ? 'T' : 'X';
        
        let resultTruyenThong;
        if (item.BetSide === 0) {
            resultTruyenThong = "TAI";
        } else if (item.BetSide === 1) {
            resultTruyenThong = "XIU";
        } else {
            resultTruyenThong = txLabel === 'T' ? "TAI" : "XIU";
        }
        
        return {
            session: item.SessionId,
            dice: [item.FirstDice, item.SecondDice, item.ThirdDice],
            total: total,
            result: resultTruyenThong,
            tx: txLabel
        };
    });
    
    return arr.sort((a, b) => a.session - b.session);
}

function lastN(arr, n) {
    return arr.slice(Math.max(0, arr.length - n));
}

function majority(obj) {
    let maxK = null,
        maxV = -Infinity;
    for (const k in obj)
        if (obj[k] > maxV) {
            maxV = obj[k];
            maxK = k;
        }
    return {
        key: maxK,
        val: maxV
    };
}

function sum(nums) {
    return nums.reduce((a, b) => a + b, 0);
}

function avg(nums) {
    return nums.length ? sum(nums) / nums.length : 0;
}

function entropy(arr) {
    if (!arr.length) return 0;
    const freq = arr.reduce((a, v) => {
        a[v] = (a[v] || 0) + 1;
        return a;
    }, {});
    const n = arr.length;
    let e = 0;
    for (const k in freq) {
        const p = freq[k] / n;
        e -= p * Math.log2(p);
    }
    return e;
}

function similarity(a, b) {
    if (a.length !== b.length) return 0;
    let m = 0;
    for (let i = 0; i < a.length; i++)
        if (a[i] === b[i]) m++;
    return m / a.length;
}

function extractFeatures(history) {
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const features = {
        tx,
        totals,
        freq: tx.reduce((a, v) => {
            a[v] = (a[v] || 0) + 1;
            return a;
        }, {})
    };

    let runs = [],
        cur = tx[0],
        len = 1;
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur) len++;
        else {
            runs.push({
                val: cur,
                len
            });
            cur = tx[i];
            len = 1;
        }
    }
    if (tx.length) runs.push({
        val: cur,
        len
    });
    features.runs = runs;
    features.maxRun = runs.reduce((m, r) => Math.max(m, r.len), 0) || 0;

    features.meanTotal = avg(totals);
    features.stdTotal = Math.sqrt(avg(totals.map(t => Math.pow(t - features.meanTotal, 2))));
    features.entropy = entropy(tx);

    return features;
}

// --- AI PATTERN RECOGNITION ENGINE ---
class PatternRecognitionEngine {
    constructor() {
        this.patterns = PATTERN_DATABASE;
        this.detectedPatterns = new Map();
        this.patternWeights = new Map();
        this.patternConfidence = new Map();
        this.initializeWeights();
    }
    
    initializeWeights() {
        for (const pattern in this.patterns) {
            this.patternWeights.set(pattern, 1.0);
            this.patternConfidence.set(pattern, 0.0);
        }
    }
    
    detectPatterns(txString) {
        const detected = new Map();
        const lowerStr = txString.toLowerCase();
        
        for (const [patternName, patternVariants] of Object.entries(this.patterns)) {
            for (const variant of patternVariants) {
                if (lowerStr.endsWith(variant)) {
                    if (!detected.has(patternName)) {
                        detected.set(patternName, []);
                    }
                    detected.get(patternName).push({
                        variant,
                        length: variant.length,
                        position: lowerStr.length - variant.length
                    });
                    break;
                }
            }
        }
        
        const sortedPatterns = Array.from(detected.entries())
            .sort((a, b) => {
                const maxLenA = Math.max(...a[1].map(p => p.length));
                const maxLenB = Math.max(...b[1].map(p => p.length));
                return maxLenB - maxLenA;
            });
        
        this.detectedPatterns = new Map(sortedPatterns);
        return this.detectedPatterns;
    }
    
    predictNext(history, currentPattern) {
        if (!currentPattern || !this.detectedPatterns.has(currentPattern)) return null;
        
        const patternVariants = this.patterns[currentPattern];
        let tScore = 0;
        let xScore = 0;
        
        for (const variant of patternVariants) {
            if (variant.length >= 2) {
                const lastChar = variant[variant.length - 1];
                
                if (lastChar === 't') {
                    tScore += this.patternWeights.get(currentPattern) * 1.5;
                } else if (lastChar === 'x') {
                    xScore += this.patternWeights.get(currentPattern) * 1.5;
                }
                
                const tRatio = (variant.split('t').length - 1) / variant.length;
                const xRatio = (variant.split('x').length - 1) / variant.length;
                
                if (tRatio > xRatio) {
                    tScore += this.patternWeights.get(currentPattern) * (tRatio - xRatio) * 2;
                } else {
                    xScore += this.patternWeights.get(currentPattern) * (xRatio - tRatio) * 2;
                }
            }
        }
        
        const total = tScore + xScore;
        const confidence = total > 0 ? Math.max(tScore, xScore) / total : 0;
        this.patternConfidence.set(currentPattern, confidence);
        
        if (tScore === 0 && xScore === 0) return null;
        return tScore > xScore ? 'T' : 'X';
    }
    
    getMostConfidentPattern() {
        let bestPattern = null;
        let bestConfidence = 0;
        
        for (const [pattern, confidence] of this.patternConfidence) {
            if (confidence > bestConfidence) {
                bestConfidence = confidence;
                bestPattern = pattern;
            }
        }
        
        return bestPattern;
    }
}

// --- CORE ALGORITHMS TỐI ƯU ---

// 1. Thuật toán Cân bằng Tần suất
function algo5_freqRebalance(history) {
    const tx = history.map(h => h.tx);
    const freq = tx.reduce((a, v) => { a[v] = (a[v] || 0) + 1; return a; }, {});
    
    const total = (freq['T'] || 0) + (freq['X'] || 0);
    if (total < 20) return null;
    
    const tRatio = (freq['T'] || 0) / total;
    const xRatio = (freq['X'] || 0) / total;
    
    if (tRatio > 0.6 && tRatio - xRatio > 0.15) return 'X';
    if (xRatio > 0.6 && xRatio - tRatio > 0.15) return 'T';
    
    const recent = tx.slice(-15);
    const recentT = recent.filter(c => c === 'T').length;
    const recentX = recent.filter(c => c === 'X').length;
    
    if (recentT >= 10) return 'X';
    if (recentX >= 10) return 'T';
    
    return null;
}

// 2. Thuật toán Markov
function algoA_markov(history) {
    const tx = history.map(h => h.tx);
    const order = 3;
    if (tx.length < order + 10) return null;
    const transitions = {};
    for (let i = 0; i <= tx.length - order - 1; i++) {
        const key = tx.slice(i, i + order).join('');
        const next = tx[i + order];
        transitions[key] = transitions[key] || { T: 0, X: 0 };
        transitions[key][next]++;
    }
    const lastKey = tx.slice(-order).join('');
    const counts = transitions[lastKey];
    if (!counts || (counts.T + counts.X) < 5) return null;
    
    const total = counts.T + counts.X;
    const confidence = Math.abs(counts.T - counts.X) / total;
    
    if (confidence > 0.7) {
        return (counts['T'] > counts['X']) ? 'T' : 'X';
    }
    return null;
}

// 3. Neo Pattern Recognition
function algoS_NeoPattern(history, patternEngine) {
    const tx = history.map(h => h.tx);
    const len = tx.length;
    if (len < 25) return null;

    const txString = tx.join('').toLowerCase();
    patternEngine.detectPatterns(txString);
    const bestPattern = patternEngine.getMostConfidentPattern();
    
    if (bestPattern && patternEngine.patternConfidence.get(bestPattern) > 0.7) {
        return patternEngine.predictNext(history, bestPattern);
    }

    const patternLengths = [3, 4, 5, 6];
    let bestPred = null;
    let maxMatches = -1;

    for (const patLen of patternLengths) {
        if (len < patLen * 2) continue;
        const targetPattern = tx.slice(-patLen).join('');
        let counts = { T: 0, X: 0 };
        let totalSimilarity = 0;

        for (let i = 0; i <= len - patLen - 1; i++) {
            const historyPattern = tx.slice(i, i + patLen).join('');
            const score = similarity(historyPattern, targetPattern);

            if (score >= 0.8) {
                counts[tx[i + patLen]] += score;
                totalSimilarity += score;
            }
        }

        if (totalSimilarity > 0 && counts.T !== counts.X) {
            if (totalSimilarity > maxMatches) {
                maxMatches = totalSimilarity;
                const tScore = counts.T / totalSimilarity;
                const xScore = counts.X / totalSimilarity;
                bestPred = tScore > xScore ? 'T' : 'X';
            }
        }
    }

    return bestPred;
}

// 4. Deep AI Analysis
function algoF_SuperDeepAnalysis(history) {
    if (history.length < 50) return null;
    const features = extractFeatures(history);
    const tx = features.tx;

    const recentTotals = history.slice(-20).map(h => h.total);
    const recentAvg = avg(recentTotals);
    
    if (recentAvg > 12.5 && features.meanTotal > 12) return 'X'; 
    if (recentAvg < 8.5 && features.meanTotal < 9) return 'T'; 

    if (features.entropy > 0.95) {
        const last10 = tx.slice(-10);
        const tCount = last10.filter(c => c === 'T').length;
        const xCount = last10.filter(c => c === 'X').length;
        
        if (tCount >= 6) return 'X';
        if (xCount >= 6) return 'T';
        
        return tx.at(-1) === 'T' ? 'X' : 'T';
    }

    const cycleLengths = [8, 12];
    for (const len of cycleLengths) {
        if (tx.length < len * 2) continue;
        
        const target = tx.slice(-len).join('');
        let tAfter = 0, xAfter = 0;
        
        for (let i = 0; i <= tx.length - len - 1; i++) {
            if (tx.slice(i, i + len).join('') === target) {
                const next = tx[i + len];
                next === 'T' ? tAfter++ : xAfter++;
            }
        }
        
        if (tAfter + xAfter >= 4) {
            const ratio = tAfter / (tAfter + xAfter);
            if (ratio > 0.75) return 'T';
            if (ratio < 0.25) return 'X';
        }
    }

    return null;
}

// 5. AI Bẻ Cầu & Theo Cầu
function algoG_SuperBridgePredictor(history) {
    const runs = extractFeatures(history).runs;
    if (runs.length < 3) return null;
    const lastRun = runs.at(-1);

    // Theo cầu thông minh
    if (lastRun.len >= 2 && lastRun.len <= 5) {
        if (runs.length >= 4) {
            const prevRuns = runs.slice(-4);
            const stable = prevRuns.every(r => r.len >= 2 && r.len <= 5);
            if (stable) return lastRun.val;
        }
    }

    // Bẻ cầu thông minh
    if (lastRun.len >= 6) {
        return lastRun.val === 'T' ? 'X' : 'T';
    }
    
    // Phát hiện mẫu 1-1
    const tx = history.map(h => h.tx);
    const last15 = tx.slice(-15);
    if (last15.length >= 10) {
        let changes = 0;
        for (let i = 1; i < last15.length; i++) {
            if (last15[i] !== last15[i-1]) changes++;
        }
        
        if (changes >= 10) {
            return last15[last15.length - 1] === 'T' ? 'X' : 'T';
        }
    }
    
    return null;
}

// 6. AI Nhận diện Mẫu Cầu Cơ bản
function algoI_BasicPatternRecognizer(history, patternEngine) {
    if (history.length < 20) return null;
    
    const tx = history.map(h => h.tx);
    const txString = tx.join('').toLowerCase();
    
    const last10 = txString.slice(-10);
    
    // Pattern 1-1
    if (/^(tx){3,}|(xt){3,}$/.test(last10.slice(-6))) {
        return last10.slice(-1) === 't' ? 'X' : 'T';
    }
    
    // Pattern bệt
    if (/^t{4,}$/.test(last10.slice(-4))) return 'T';
    if (/^x{4,}$/.test(last10.slice(-4))) return 'X';
    
    // Pattern 2-2
    if (/^(ttxx){2,}|(xxtt){2,}$/.test(last10.slice(-8))) {
        return last10.slice(-2) === 'tt' ? 'X' : 'T';
    }
    
    // Pattern 3-3
    if (/^(tttxxx){2,}|(xxxttt){2,}$/.test(last10.slice(-6))) {
        const lastThree = last10.slice(-3);
        return lastThree === 'ttt' ? 'X' : 'T';
    }
    
    return null;
}

// 7. AI Nhận diện Mẫu Cầu Phức tạp
function algoJ_AdvancedPatternRecognizer(history, patternEngine) {
    if (history.length < 30) return null;
    
    const tx = history.map(h => h.tx);
    const txString = tx.join('').toLowerCase();
    
    patternEngine.detectPatterns(txString);
    const patterns = Array.from(patternEngine.detectedPatterns.keys());
    
    const complexPatterns = patterns.filter(p => 
        !['1-1', 'bệt', '2-2', '3-3', '4-4'].includes(p)
    );
    
    if (complexPatterns.length > 0) {
        const sortedPatterns = complexPatterns.sort((a, b) => {
            const confA = patternEngine.patternConfidence.get(a) || 0;
            const confB = patternEngine.patternConfidence.get(b) || 0;
            return confB - confA;
        });
        
        const bestPattern = sortedPatterns[0];
        const confidence = patternEngine.patternConfidence.get(bestPattern) || 0;
        
        if (confidence > 0.65) {
            return patternEngine.predictNext(history, bestPattern);
        }
    }
    
    return null;
}

// 8. AI Thích nghi Mẫu Cầu
function algoK_AdaptivePattern(history, patternEngine) {
    if (history.length < 35) return null;
    
    const tx = history.map(h => h.tx);
    const features = extractFeatures(history);
    
    const recent20 = tx.slice(-20);
    const changes = recent20.filter((val, idx, arr) => idx > 0 && val !== arr[idx-1]).length;
    const changeRate = changes / 19;
    
    if (changeRate > 0.75) {
        const last5 = tx.slice(-5);
        const tCount = last5.filter(c => c === 'T').length;
        const xCount = last5.filter(c => c === 'X').length;
        
        if (tCount >= 4) return 'X';
        if (xCount >= 4) return 'T';
        
        patternEngine.detectPatterns(tx.join('').toLowerCase());
        const bestPattern = patternEngine.getMostConfidentPattern();
        
        if (bestPattern && (patternEngine.patternConfidence.get(bestPattern) || 0) > 0.6) {
            return patternEngine.predictNext(history, bestPattern);
        }
    }
    
    return null;
}

// 9. AI Học máy Tổng hợp
function algoL_MachineLearningAI(history, patternEngine) {
    if (history.length < 45) return null;
    
    const predictions = [];
    const weights = [];
    
    const algoList = [
        { fn: () => algo5_freqRebalance(history), w: 0.8 },
        { fn: () => algoA_markov(history), w: 0.85 },
        { fn: () => algoS_NeoPattern(history, patternEngine), w: 0.95 },
        { fn: () => algoF_SuperDeepAnalysis(history), w: 0.9 },
        { fn: () => algoG_SuperBridgePredictor(history), w: 0.9 },
        { fn: () => algoI_BasicPatternRecognizer(history, patternEngine), w: 0.8 },
        { fn: () => algoJ_AdvancedPatternRecognizer(history, patternEngine), w: 0.85 }
    ];
    
    for (const algo of algoList) {
        const pred = algo.fn();
        if (pred) {
            predictions.push(pred);
            weights.push(algo.w);
        }
    }
    
    if (predictions.length === 0) return null;
    
    let tScore = 0, xScore = 0;
    for (let i = 0; i < predictions.length; i++) {
        if (predictions[i] === 'T') tScore += weights[i];
        else xScore += weights[i];
    }
    
    const total = tScore + xScore;
    const tRatio = tScore / total;
    const xRatio = xScore / total;
    
    if (tRatio > 0.65) return 'T';
    if (xRatio > 0.65) return 'X';
    
    if (Math.abs(tRatio - xRatio) < 0.15) {
        const recent = history.slice(-8).map(h => h.tx);
        const tRecent = recent.filter(c => c === 'T').length;
        const xRecent = recent.filter(c => c === 'X').length;
        
        if (tRecent > xRecent * 1.5) return 'X';
        if (xRecent > tRecent * 1.5) return 'T';
    }
    
    return null;
}

// --- DANH SÁCH THUẬT TOÁN TỐI ƯU ---
const ALL_ALGS = [
    { id: 'algo5_freqrebalance', fn: algo5_freqRebalance },
    { id: 'a_markov', fn: algoA_markov },
    { id: 's_neo_pattern', fn: (history, patternEngine) => algoS_NeoPattern(history, patternEngine) },
    { id: 'f_super_deep_analysis', fn: algoF_SuperDeepAnalysis },
    { id: 'g_super_bridge_predictor', fn: algoG_SuperBridgePredictor },
    { id: 'i_basic_pattern', fn: (history, patternEngine) => algoI_BasicPatternRecognizer(history, patternEngine) },
    { id: 'j_advanced_pattern', fn: (history, patternEngine) => algoJ_AdvancedPatternRecognizer(history, patternEngine) },
    { id: 'k_adaptive_pattern', fn: (history, patternEngine) => algoK_AdaptivePattern(history, patternEngine) },
    { id: 'l_machine_learning', fn: (history, patternEngine) => algoL_MachineLearningAI(history, patternEngine) }
];

// --- ENSEMBLE CLASSIFIER ---
class SEIUEnsemble {
    constructor(algorithms, patternEngine, opts = {}) { 
        this.algs = algorithms;
        this.patternEngine = patternEngine;
        this.weights = {};
        this.emaAlpha = opts.emaAlpha ?? 0.1;
        this.minWeight = opts.minWeight ?? 0.001;
        this.historyWindow = opts.historyWindow ?? 300;
        for (const a of algorithms) this.weights[a.id] = 1;
    }
    
    fitInitial(history) {
        const window = lastN(history, this.historyWindow);
        if (window.length < 20) return;
        const algScores = {};
        for (const a of this.algs) algScores[a.id] = 0;

        for (let i = 10; i < window.length; i++) {
            const prefix = window.slice(0, i);
            const actual = window[i].tx;
            for (const a of this.algs) {
                let pred;
                if (a.id === 's_neo_pattern' || a.id === 'i_basic_pattern' || 
                    a.id === 'j_advanced_pattern' || a.id === 'k_adaptive_pattern' || 
                    a.id === 'l_machine_learning') {
                    pred = a.fn(prefix, this.patternEngine);
                } else {
                    pred = a.fn(prefix);
                }
                
                if (pred && pred === actual) algScores[a.id]++;
            }
        }

        let total = 0;
        for (const id in algScores) {
            const w = (algScores[id] || 0) + 1;
            this.weights[id] = w;
            total += w;
        }
        for (const id in this.weights) this.weights[id] = Math.max(this.minWeight, this.weights[id] / total);
    }

    updateWithOutcome(historyPrefix, actualTx) {
        for (const a of this.algs) {
            let pred;
            if (a.id === 's_neo_pattern' || a.id === 'i_basic_pattern' || 
                a.id === 'j_advanced_pattern' || a.id === 'k_adaptive_pattern' || 
                a.id === 'l_machine_learning') {
                pred = a.fn(historyPrefix, this.patternEngine);
            } else {
                pred = a.fn(historyPrefix);
            }
            
            const correct = pred === actualTx ? 1 : 0;
            const currentWeight = this.weights[a.id] || this.minWeight;
            const reward = correct ? 1.05 : 0.95;
            const targetWeight = currentWeight * reward;
            const nw = this.emaAlpha * targetWeight + (1 - this.emaAlpha) * currentWeight;
            this.weights[a.id] = Math.max(this.minWeight, nw);
        }

        const s = Object.values(this.weights).reduce((a, b) => a + b, 0) || 1;
        for (const id in this.weights) this.weights[id] /= s;
    }

    predict(history) {
        const votes = {};
        for (const a of this.algs) {
            let pred;
            if (a.id === 's_neo_pattern' || a.id === 'i_basic_pattern' || 
                a.id === 'j_advanced_pattern' || a.id === 'k_adaptive_pattern' || 
                a.id === 'l_machine_learning') {
                pred = a.fn(history, this.patternEngine);
            } else {
                pred = a.fn(history);
            }
            
            if (!pred) continue;
            
            votes[pred] = (votes[pred] || 0) + (this.weights[a.id] || 0);
        }

        if (!votes['T'] && !votes['X']) {
            const fallback = algo5_freqRebalance(history) || 'T';
            return {
                prediction: fallback === 'T' ? 'tài' : 'xỉu',
                confidence: 0.55,
                rawPrediction: fallback
            };
        }

        const {
            key: best,
            val: bestVal
        } = majority(votes);
        const total = Object.values(votes).reduce((a, b) => a + b, 0);
        const confidence = Math.min(0.98, Math.max(0.55, total > 0 ? bestVal / total : 0.55));

        return {
            prediction: best === 'T' ? 'tài' : 'xỉu',
            confidence,
            rawPrediction: best
        };
    }
}

// --- MANAGER CLASS ---
class SEIUManager {
    constructor(opts = {}) {
        this.history = [];
        this.patternEngine = new PatternRecognitionEngine();
        this.ensemble = new SEIUEnsemble(ALL_ALGS, this.patternEngine, {
            emaAlpha: opts.emaAlpha ?? 0.1,
            historyWindow: opts.historyWindow ?? 300
        });
        this.currentPrediction = null;
        this.statsManager = new StatsManager();
    }
    
    calculateInitialStats() {
        const minStart = 10;
        if (this.history.length < minStart) return;
        
        for (let i = minStart; i < this.history.length; i++) {
            const historyPrefix = this.history.slice(0, i);
            const actualTx = this.history[i].tx;
            this.ensemble.updateWithOutcome(historyPrefix, actualTx);
        }
    }

    loadInitial(lines) {
        this.history = lines;
        this.ensemble.fitInitial(this.history);
        this.calculateInitialStats();
        this.currentPrediction = this.getPrediction();
        
        const nextSession = this.history.at(-1) ? this.history.at(-1).session + 1 : 'N/A';
        if (nextSession !== 'N/A') {
            this.statsManager.recordPrediction(nextSession, this.currentPrediction.rawPrediction);
        }
    }

    pushRecord(record) {
        this.statsManager.recordOutcome(record.session, record.tx);
        this.history.push(record);

        const prefix = this.history.slice(0, -1);
        if (prefix.length >= 3) {
            this.ensemble.updateWithOutcome(prefix, record.tx);
        }
        
        this.currentPrediction = this.getPrediction();
        this.statsManager.recordPrediction(record.session + 1, this.currentPrediction.rawPrediction);
    }

    getPrediction() {
        return this.ensemble.predict(this.history);
    }

    getStats() {
        return this.statsManager.getStats();
    }
}

const seiuManager = new SEIUManager();

// --- API SERVER ---
const app = fastify({
    logger: false
});
await app.register(cors, {
    origin: "*"
});

// --- FETCH DATA VỚI RETRY ---
async function fetchWithRetry(url, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(url, { 
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            clearTimeout(timeout);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function fetchAndProcessHistory() {
    try {
        const data = await fetchWithRetry(API_URL);
        const newHistory = parseLines(data);
        
        if (newHistory.length === 0) {
            return;
        }

        const lastSessionInHistory = newHistory.at(-1);

        if (!currentSessionId) {
            seiuManager.loadInitial(newHistory);
            txHistory = newHistory;
            currentSessionId = lastSessionInHistory.session;
        } else if (lastSessionInHistory.session > currentSessionId) {
            const newRecords = newHistory.filter(r => r.session > currentSessionId);
            
            for (const record of newRecords) {
                seiuManager.pushRecord(record);
                txHistory.push(record);
            }
            
            if (txHistory.length > 200) {
                txHistory = txHistory.slice(txHistory.length - 200);
            }
            currentSessionId = lastSessionInHistory.session;
        }

    } catch (e) {
        // Silent error handling
    }
}

// Khởi động lần đầu
await fetchAndProcessHistory();

// Thiết lập interval
clearInterval(fetchInterval);
fetchInterval = setInterval(fetchAndProcessHistory, 4000);

// --- ENDPOINTS ---
// Endpoint dự đoán
app.get("/api/taixiumd5/xocdia88/thinhtool", async () => {
    const lastResult = txHistory.at(-1) || null;
    const currentPrediction = seiuManager.currentPrediction;

    if (!lastResult || !currentPrediction) {
        return {
            id: "@thinhtool",
            phien_truoc: null,
            xuc_xac1: null,
            xuc_xac2: null,
            xuc_xac3: null,
            tong: null,
            ket_qua: "đang chờ...",
            phien_hien_tai: currentSessionId ? currentSessionId + 1 : null,
            du_doan: "chưa có",
            do_tin_cay: "0%",
        };
    }

    return {
        id: "@thinhtool",
        phien_truoc: lastResult.session,
        xuc_xac1: lastResult.dice[0],
        xuc_xac2: lastResult.dice[1],
        xuc_xac3: lastResult.dice[2],
        tong: lastResult.total,
        ket_qua: lastResult.result.toLowerCase(),
        phien_hien_tai: lastResult.session + 1,
        du_doan: currentPrediction.prediction,
        do_tin_cay: `${(currentPrediction.confidence * 100).toFixed(0)}%`,
    };
});

// Endpoint lịch sử
app.get("/api/taixiumd5/history/thinhtool", async () => { 
    if (!txHistory.length) return {
        message: "không có dữ liệu lịch sử."
    };
    
    const reversedHistory = [...txHistory].sort((a, b) => b.session - a.session);
    
    return reversedHistory.map((i) => ({
        session: i.session,
        dice: i.dice,
        total: i.total,
        result: i.result.toLowerCase(),
        tx_label: i.tx.toLowerCase(),
    }));
});

// Endpoint thống kê
app.get("/api/taixiumd5/xocdia88/stats", async () => {
    return seiuManager.getStats();
});

// Endpoint root
app.get("/", async () => { 
    return {
        status: "ok",
        server: "XocDia88 AI Pro",
        version: "2.0",
        endpoints: [
            "/api/taixiumd5/xocdia88/thinhtool",
            "/api/taixiumd5/history/thinhtool",
            "/api/taixiumd5/xocdia88/stats"
        ]
    };
});

// --- SERVER START ---
const start = async () => {
    try {
        await app.listen({
            port: PORT,
            host: "0.0.0.0"
        });
        console.log("Server Chạy Thành công tại cổng 3000");
    } catch (err) {
        const fs = await import("node:fs");
        const logFile = path.join(__dirname, "server-error.log");
        const errorMsg = `
================= SERVER ERROR =================
Time: ${new Date().toISOString()}
Error: ${err.message}
Stack: ${err.stack}
=================================================
`;
        fs.writeFileSync(logFile, errorMsg, {
            encoding: "utf8",
            flag: "a+"
        });
        process.exit(1);
    }
};

start();