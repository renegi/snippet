// Text comparison for matching on-screen text to catalog titles.
// On-screen titles are often cut off: players truncate long titles ("Esther Calling - Never Bee")
// and lock-screen marquees show a window from the middle ("ading the labor market tea"),
// so the first and last words of the screen text may be partial words.

// Lowercases, strips accents and punctuation, and collapses whitespace.
// Apostrophes are dropped rather than split on, so "Esther's" becomes "esthers".
function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const tokenize = text => normalize(text).split(' ').filter(Boolean);

function levenshtein(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// How well one screen word matches one title word (0-1). The first screen word may be the
// end of a title word, and the last one its start, because of truncation.
function wordMatch(screenWord, titleWord, { first, last }) {
  if (screenWord === titleWord) return 1;
  if (first && titleWord.endsWith(screenWord)) return 1;
  if (last && titleWord.startsWith(screenWord)) return 1;
  if (screenWord.length >= 4 && titleWord.length >= 4) {
    // OCR misreads ("Footbal1") and small spelling differences
    const longest = Math.max(screenWord.length, titleWord.length);
    const ratio = 1 - levenshtein(screenWord, titleWord) / longest;
    if (ratio >= 0.75) return ratio;
  }
  return 0;
}

// Aligns screen words to title words, preferring title order.
// Returns how much of the screen text the title explains (`screenCoverage`) and how much of
// the title the screen text covers (`titleCoverage`), both weighted by word length so short
// words like "the" count for less.
function align(screenText, title) {
  const screen = tokenize(screenText);
  const titleWords = tokenize(title);
  if (screen.length === 0 || titleWords.length === 0) {
    return { screenCoverage: 0, titleCoverage: 0 };
  }

  const titleMatched = new Array(titleWords.length).fill(0);
  let matchedWeight = 0;
  let totalWeight = 0;
  let next = 0; // next title position for an in-order match

  screen.forEach((word, i) => {
    const position = { first: i === 0, last: i === screen.length - 1 };
    const weight = word.length;
    totalWeight += weight;

    let best = { score: 0, index: -1 };
    titleWords.forEach((titleWord, j) => {
      // Out-of-order matches count for less, so a jumble of shared words scores below a real match
      const score = wordMatch(word, titleWord, position) * (j >= next ? 1 : 0.7);
      if (score > best.score) best = { score, index: j };
    });

    if (best.index >= 0) {
      matchedWeight += weight * best.score;
      titleMatched[best.index] = Math.max(titleMatched[best.index], best.score);
      if (best.index >= next) next = best.index + 1;
    }
  });

  const titleWeight = titleWords.reduce((sum, w) => sum + w.length, 0);
  const titleMatchedWeight = titleWords.reduce((sum, w, j) => sum + w.length * titleMatched[j], 0);

  return {
    screenCoverage: matchedWeight / totalWeight,
    titleCoverage: titleMatchedWeight / titleWeight
  };
}

// Score (0-1) for screen text that may be a truncated window of an episode title.
// Mostly "is every screen word in the title", with a small preference for covering more of it.
function titleScore(screenText, title) {
  const a = normalize(screenText);
  const b = normalize(title);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const { screenCoverage, titleCoverage } = align(screenText, title);
  return screenCoverage * (0.85 + 0.15 * titleCoverage);
}

const ARTICLES = new Set(['the', 'a', 'an']);

// Score (0-1) for screen text against a podcast name. Names are usually shown in full, but
// may be cut off or have artwork text merged in, so both directions count.
function nameScore(screenText, name) {
  const a = normalize(screenText);
  const b = normalize(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const { screenCoverage, titleCoverage } = align(screenText, name);
  let score = 0.6 * screenCoverage + 0.4 * titleCoverage;

  const screen = a.split(' ');
  const words = b.split(' ');
  // Players may add a subtitle the catalog name lacks: "Good One: A Podcast About Jokes" is
  // "Good One" in Apple's catalog. Very short names are too common as openings to count.
  if (words.length < screen.length && words.every((word, i) => word === screen[i]) && b.replace(/ /g, '').length >= 6) {
    score = Math.max(score, 0.8);
  }
  // Screens cut names off at the end, not the start, so a catalog name with extra words in
  // front ("Not Another Podcast" for "Another Podcast") is probably a different show.
  if (!ARTICLES.has(words[0]) && !screen.includes(words[0]) && words.indexOf(screen[0]) > 0) {
    score *= 0.9;
  }
  return score;
}

// How much of the screen text (0-1) is made up of the name's words. Artwork often repeats
// parts of the podcast name ("search", "engine") as separate lines.
const containedIn = (screenText, name) => align(screenText, name).screenCoverage;

// Search terms for screen text: normalized, without single letters and repeated words
// (artwork text often repeats the podcast name on the same line).
function searchTerms(text) {
  const words = tokenize(text).filter(word => word.length > 1 || /\d/.test(word));
  return [...new Set(words)].join(' ');
}

module.exports = { normalize, tokenize, levenshtein, titleScore, nameScore, containedIn, searchTerms };
