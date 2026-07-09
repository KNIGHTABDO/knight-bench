const DIACRITICS_TO_STRIP = /[ً-ٍَ-ِّْٖ-ٜ٘ٚٝـۖ-ۜ۞-ۤۧ-۪ۨ-ۭ࣓-ࣰࣣ࣡-ࣿ]/g;
const QURAN_MARKERS = /[۝۞ࣔ-࣢]/g;
const ALEF_NORMALIZATION_MAP = { 'آ': 'ا', 'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا' };
const EXTRA_MAP = { 'ؤ': 'و', 'ئ': 'ي', 'ى': 'ي', 'ة': 'ه' };
function normalizeAlefForSearch(s) {
  return s.replace(/[آأإٱ]/g, c => ALEF_NORMALIZATION_MAP[c])
          .replace(/ٰ/g, 'ا')
          .replace(/[ؤئ]/g, c => EXTRA_MAP[c]);
}
function stripDiacritics(verse) {
  if (!verse) return '';
  let t = verse.normalize('NFKD');
  t = t.replace(QURAN_MARKERS, '');
  t = t.replace(DIACRITICS_TO_STRIP, '');
  return t;
}
function normalizeForSearch(verse) {
  let s = stripDiacritics(verse);
  s = normalizeAlefForSearch(s);
  return s.replace(/\s+/g, ' ').trim();
}
const input = 'بِسْمِ ٱللَّهِ هَٰذَا مُؤْمِنٌ۝';
console.log('in :', input);
console.log('out:', normalizeForSearch(input));
console.log('hamza-waw preserved as vav path:', normalizeForSearch('مُؤْمِن'));
