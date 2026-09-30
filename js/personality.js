import { buildResult, createAttempt } from './personality-domain.js';

const $ = selector => document.querySelector(selector);
const TYPES = {
  RLCG:['变动轻松对抗小聚型','骰子一响，熟人局就开火。','你偏爱轻快、直接、带一点意外的熟人对局：规则要易懂，反馈要及时，最好还能在关键时刻翻盘。'],
  RLCP:['变动轻松对抗派对型','人越多，翻盘越热闹。','你喜欢把简单规则、强互动和不确定性放在同一张桌上，享受多人局里不断变化的竞争张力。'],
  RLAG:['变动轻松氛围小聚型','熟人局里，意外才是调味料。','你重视轻松上手与共同体验，也愿意让随机事件制造故事；胜负存在，但不该盖过桌边的气氛。'],
  RLAP:['变动轻松氛围派对型','全场一起笑，骰子负责添柴。','你偏好门槛低、参与广、变化多的聚会游戏，享受每个人都能被卷入的戏剧性。'],
  RHCG:['变动深度对抗小聚型','熟人修罗场，规划也得会翻盘。','你愿意投入复杂系统，但仍期待局势保有不可预测性；小规模的高密度竞争最能让你投入。'],
  RHCP:['变动深度对抗派对型','把复杂策略扔进一场大乱斗。','你寻找的是多人环境中的深度博弈与局势变化，既能算，也不拒绝意外。'],
  RHAG:['变动深度氛围小聚型','深度规则，熟人故事，偶尔失控。','你愿意学习复杂规则，只要它能支持丰富叙事和共同沉浸；熟悉的伙伴让深度体验更有回响。'],
  RHAP:['变动深度氛围派对型','一桌人越多，故事越不可控。','你喜欢高复杂度与高社交密度并存的游戏，让多人互动、变化与叙事共同推动一场完整体验。'],
  SLCG:['构筑轻松对抗小聚型','少算一点，稳稳赢下熟人局。','你偏爱规则清晰、节奏轻快，同时保留选择与竞争反馈的游戏；稳定并不等于无聊。'],
  SLCP:['构筑轻松对抗派对型','规则要轻，胜负要响。','你希望多人游戏能够迅速开局，又有足够明确的竞争目标和可掌控的决策空间。'],
  SLAG:['构筑轻松氛围小聚型','不乱不卷，熟人桌边刚刚好。','你重视低随机、低负担与稳定的共同体验，喜欢在熟人局里轻松推进而不被复杂度拖住。'],
  SLAP:['构筑轻松氛围派对型','让所有人上桌，别让运气拆台。','你希望聚会游戏容易加入、氛围友好，同时保有一套可靠、不会喧宾夺主的规则骨架。'],
  SHCG:['构筑深度对抗小聚型','算盘落下，熟人局无处可逃。','你享受稳定系统、长期规划和高密度对抗，少量玩家能让每个决策都产生清晰回响。'],
  SHCP:['构筑深度对抗派对型','在大桌上搭一座精算堡垒。','你把复杂策略与多人竞争结合起来，追求可研究、可复盘且能持续产生决策张力的游戏。'],
  SHAG:['构筑深度氛围小聚型','规则筑墙，故事在墙内发光。','你愿意投入长线构筑，也珍惜熟人之间共同沉浸的氛围；胜负服务于完整体验。'],
  SHAP:['构筑深度氛围派对型','人群很大，系统要稳，故事要满。','你偏好能承载多人互动的深度系统，期待规则足够扎实，同时让整桌人持续参与。']
};

let bank; let attempt; let index = 0; let result;
const landing = $('#landing'), quiz = $('#quiz'), resultView = $('#result');
const setHidden = (node, hidden) => { node.hidden = hidden; };

async function loadBank() {
  const response = await fetch('data/personality-question-bank.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('题库加载失败');
  bank = await response.json();
}

function renderQuestion() {
  const question = attempt.questions[index];
  $('#progressLabel').textContent = `${index + 1} / ${attempt.questions.length}`;
  $('#progressBar').style.width = `${((index + 1) / attempt.questions.length) * 100}%`;
  $('#questionText').textContent = question.text;
  $('#prevButton').disabled = index === 0;
  $('#answerOptions').innerHTML = bank.answerScale.map(option => `<button class="answer-option" data-value="${option.value}"><b>${option.value}</b>${option.label}</button>`).join('');
  const selected = attempt.answers[index];
  if (selected) document.querySelector(`[data-value="${selected}"]`)?.classList.add('is-selected');
  document.querySelector('.answer-option')?.focus({ preventScroll: true });
}

function begin() { attempt = createAttempt(bank); index = 0; result = null; setHidden(landing, true); setHidden(resultView, true); setHidden(quiz, false); renderQuestion(); }
function finish() { result = buildResult(bank, attempt.answers); setHidden(quiz, true); setHidden(resultView, false); renderResult(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function quit() { attempt = null; result = null; setHidden(quiz, true); setHidden(resultView, true); setHidden(landing, false); }

function renderResult() {
  const type = TYPES[result.mainCode] || ['桌边复合型', '你的桌边没有标准答案。', '你在四组偏好之间形成了独特组合，愿意根据场合切换游戏体验。'];
  const labels = result.labels;
  const dimensionRows = Object.entries(bank.dimensions).map(([key, dimension]) => `<div class="dimension-row"><div class="dimension-head"><span>${dimension.left.name}　/　${dimension.right.name}</span><span>${Math.round(result.percentages[key])}</span></div><div class="dimension-bar" role="meter" aria-label="${dimension.name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(result.percentages[key])}"><span style="width:${result.percentages[key]}%"></span></div></div>`).join('');
  const chips = labels.map(label => `<span class="result-chip">${label.label}</span>`).join('') || '<span class="result-chip">暂未触发额外标签</span>';
  resultView.innerHTML = `<article class="result-hero liquid-strong"><span class="result-code">${result.mainCode} · ${result.auxCode}</span><h1>${type[0]}</h1><p class="result-tagline">${type[1]}</p><p class="result-professional">${type[2]}</p><div class="result-chips">${chips}</div><div class="result-actions"><button class="primary-button" id="restartButton">重新测试</button><a class="secondary-button" href="tabletop.html">回到一桌</a></div></article><section class="result-panel liquid-strong"><h2>你的六条轴线</h2>${dimensionRows}</section><section class="result-panel liquid-strong"><h2>怎么读这份结果</h2><p class="session-muted">主人格由四个核心维度组成，辅人格补充你在收藏、开箱、组局和入席之间的习惯。标签只在达到极端或平衡阈值时出现。</p></section>`;
  $('#restartButton').addEventListener('click', begin);
}

$('#startButton').addEventListener('click', async () => { try { await loadBank(); begin(); } catch (error) { $('#startButton').textContent = error.message; $('#startButton').disabled = true; } });
$('#quitButton').addEventListener('click', quit);
$('#prevButton').addEventListener('click', () => { if (index > 0) { index -= 1; renderQuestion(); } });
$('#answerOptions').addEventListener('click', event => { const button = event.target.closest('[data-value]'); if (!button) return; attempt.answers[index] = Number(button.dataset.value); if (index === attempt.questions.length - 1) finish(); else { index += 1; renderQuestion(); } });
document.addEventListener('keydown', event => { if (!quiz.hidden && /^[1-5]$/.test(event.key)) document.querySelector(`[data-value="${event.key}"]`)?.click(); });
