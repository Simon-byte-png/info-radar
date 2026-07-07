export function scoreEpisode({ source, item }) {
  const title = `${item.title || ''}`.toLowerCase();
  const description = `${item.description || item.summary || ''}`.toLowerCase();
  const text = `${title}\n${description}`;

  const positiveSignals = [
    ['interview', 16],
    ['conversation with', 16],
    ['with ', 8],
    ['founder', 14],
    ['ceo', 10],
    ['cto', 10],
    ['researcher', 12],
    ['openai', 12],
    ['anthropic', 12],
    ['deepmind', 12],
    ['google', 7],
    ['meta', 7],
    ['microsoft', 7],
    ['nvidia', 10],
    ['startup', 8],
    ['ai', 10],
    ['agents', 10],
    ['llm', 10],
    ['product', 7],
    ['strategy', 7],
    ['acquired', 6],
    ['breakdown', 6]
  ];

  const negativeSignals = [
    ['rerun', -12],
    ['replay', -12],
    ['bonus', -4],
    ['news roundup', -8],
    ['emergency pod', -6],
    ['trailer', -18]
  ];

  let score = source.priority || 50;
  const reasons = [`源优先级 ${source.priority || 50}`];

  for (const [keyword, weight] of positiveSignals) {
    if (text.includes(keyword)) {
      score += weight;
      reasons.push(`命中高价值信号: ${keyword}`);
    }
  }

  for (const [keyword, weight] of negativeSignals) {
    if (text.includes(keyword)) {
      score += weight;
      reasons.push(`降权信号: ${keyword}`);
    }
  }

  if (item.enclosures?.some((e) => `${e.type || ''}`.startsWith('audio/'))) {
    score += 10;
    reasons.push('包含音频附件，可转写');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: [...new Set(reasons)].slice(0, 8)
  };
}
