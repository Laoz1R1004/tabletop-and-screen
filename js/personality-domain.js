// Pure tabletop personality scoring. Deliberately has no storage or DOM dependencies.
export const MAIN_DIMENSIONS = ['RS', 'LH', 'CA', 'GP'];
export const AUX_DIMENSIONS = ['CD', 'OF'];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const scoreFor = (answer, bank) => bank.answerScale.find(item => item.value === Number(answer))?.score ?? 0;

function seeded(seed) {
  let value = (Number(seed) >>> 0) || 1;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function shuffleQuestions(questions, seed = Date.now()) {
  const random = seeded(seed);
  const source = [...questions];
  let best = source;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = [...source];
    for (let index = candidate.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [candidate[index], candidate[swap]] = [candidate[swap], candidate[index]];
    }
    best = candidate;
    const families = candidate.map(question => question.effects.map(effect => effect.dimension).join('|'));
    if (!families.some((family, index) => index >= 2 && family === families[index - 1] && family === families[index - 2])) return candidate;
  }
  return best;
}

export function createAttempt(bank, seed = Math.floor(Math.random() * 0xFFFFFFFF)) {
  return { seed, questions: shuffleQuestions(bank.questions, seed), answers: [] };
}

export function validateQuestionBank(bank) {
  const errors = [];
  if (!bank || !Array.isArray(bank.questions)) return ['题库结构无效'];
  if (bank.questions.length !== 48) errors.push('题目总数必须为 48');
  for (const dimension of MAIN_DIMENSIONS) {
    const count = bank.questions.filter(question => question.kind === 'dedicated' && question.effects.some(effect => effect.dimension === dimension)).length;
    if (count !== 5) errors.push(`${dimension} 专属题应为 5 道`);
  }
  for (const dimension of AUX_DIMENSIONS) {
    const count = bank.questions.filter(question => question.kind === 'auxDedicated' && question.effects.some(effect => effect.dimension === dimension)).length;
    if (count !== 2) errors.push(`${dimension} 辅人格专属题应为 2 道`);
  }
  return errors;
}

function theoreticalMax(bank, dimension) {
  return bank.questions.reduce((sum, question) => sum + question.effects.filter(effect => effect.dimension === dimension).reduce((inner, effect) => inner + 2 * Number(effect.weight || 0), 0), 0);
}

export function scoreAttempt(bank, answers = []) {
  const raw = Object.fromEntries(Object.keys(bank.dimensions).map(key => [key, 0]));
  bank.questions.forEach((question, index) => {
    const base = scoreFor(answers[index], bank);
    for (const effect of question.effects) {
      const dimension = bank.dimensions[effect.dimension];
      if (!dimension) continue;
      const poleIsRight = effect.pole === dimension.right.code || effect.pole === dimension.right.name || effect.pole === 'Doer' || effect.pole === 'Follower';
      const direction = poleIsRight ? 1 : -1;
      raw[effect.dimension] += base * direction * Number(effect.polarity ?? 1) * Number(effect.weight || 0);
    }
  });
  const percentages = Object.fromEntries(Object.keys(raw).map(key => {
    const max = theoreticalMax(bank, key);
    return [key, max ? clamp(50 + 50 * raw[key] / max) : 50];
  }));
  const codes = Object.fromEntries(Object.entries(percentages).map(([key, percentage]) => {
    const dimension = bank.dimensions[key];
    return [key, percentage < 50 ? dimension.left.code : dimension.right.code];
  }));
  return { raw, percentages, codes };
}

function singleLabels(bank, percentages, codes) {
  const output = [];
  for (const [dimensionKey, percentage] of Object.entries(percentages)) {
    const dimension = bank.dimensions[dimensionKey];
    const extreme = bank.scoring.extremeRange;
    if (percentage <= extreme.leftMax || percentage >= extreme.rightMin) {
      const code = codes[dimensionKey];
      const labelKey = dimensionKey === 'CD' ? (code === 'C' ? 'Collector' : 'Doer') : dimensionKey === 'OF' ? (code === 'O' ? 'Organizer' : 'Follower') : code;
      output.push({ type: 'single', dimension: dimensionKey, code, label: bank.labels.singleDimension[labelKey] });
    }
  }
  return output;
}

function balanceLabels(bank, percentages) {
  const range = bank.scoring.balanceRange;
  return (range.enabledFor || []).filter(key => percentages[key] >= range.min && percentages[key] <= range.max)
    .map(key => ({ type: 'balance', dimension: key, label: bank.labels.balance[key] }));
}

function linkageMatches(bank, percentages) {
  // Explicit conditions keep the scoring engine transparent and match the source rule document.
  const checks = {
    'R-P': p => p.RS <= 10 && p.GP >= 90, 'R-C': p => p.RS <= 10 && p.CA <= 10,
    'R-A': p => p.RS <= 10 && p.CA >= 90, 'S-C': p => p.RS >= 90 && p.CA <= 10,
    'C-G': p => p.CA <= 10 && p.GP <= 10, 'A-P': p => p.CA >= 90 && p.GP >= 90
  };
  return bank.labels.linkage.filter(item => checks[item.id]?.(percentages)).slice(0, bank.scoring.maxLinkageLabels).map(item => ({ type: 'linkage', ...item }));
}

export function buildResult(bank, answers) {
  const score = scoreAttempt(bank, answers);
  const mainCode = MAIN_DIMENSIONS.map(key => score.codes[key]).join('');
  const auxCode = AUX_DIMENSIONS.map(key => score.codes[key]).join('');
  return { ...score, mainCode, auxCode, labels: [...singleLabels(bank, score.percentages, score.codes), ...balanceLabels(bank, score.percentages), ...linkageMatches(bank, score.percentages)] };
}
