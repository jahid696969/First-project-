export function normalize(text) {
  return text.normalize('NFKC').replace(/[০-৯]/g, c => String('০১২৩৪৫৬৭৮৯'.indexOf(c)))
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const classWords = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
  প্রথম: 1, দ্বিতীয়: 2, দ্বিতীয়: 2, তৃতীয়: 3, তৃতীয়: 3, চতুর্থ: 4,
  পঞ্চম: 5, ষষ্ঠ: 6, সপ্তম: 7, অষ্টম: 8, নবম: 9, দশম: 10, একাদশ: 11, দ্বাদশ: 12
};

export function classify(text) {
  const t = normalize(text);
  if (/অভিযোগ|হয়রানি|হয়রানি|প্রতারণা|নিরাপত্তা|complaint|harass|scam|refund|ফেরত|অশালীন|হুমকি|অসদাচরণ/.test(t)) return 'complaint';
  if (/commission|কমিশন/.test(t)) return 'policy_question';
  const tutor = /আমি টিউটর|আমি শিক্ষক|আমি পড়াই|আমি পড়াই|i am a tutor|i'm a tutor|i teach|ami tutor|ami porai|টিউটর হিসেবে|tutor registration|register as|নিবন্ধন|apply|আবেদন|job\s*(?:id|#)|জব\s*আইডি/.test(t);
  const guardian = /টিউটর চাই|টিউটর লাগবে|টিচার লাগবে|শিক্ষক চাই|শিক্ষক লাগবে|tutor chai|tutor lagbe|teacher lagbe|need (?:a |an )?(?:tutor|teacher)|looking for (?:a )?tutor|আমার ছেলে|আমার মেয়ে|আমার মেয়ে|my (?:son|daughter)/.test(t);
  if (tutor && guardian) return 'uncertain';
  if (tutor) return 'tutor';
  if (guardian) return 'guardian';
  if (/^(?:hello|hi|হ্যালো|আসসালামু আলাইকুম|সালাম)[.!।\s]*$/.test(t)) return 'general';
  return 'uncertain';
}

const subjectPatterns = [
  ['Math', /\bmath(?:s|ematics)?\b|গণিত|অংক|অঙ্ক/],
  ['English', /\benglish\b(?!\s*(?:medium|version))|ইংরেজি(?!\s*(?:মাধ্যম|ভার্সন))/],
  ['Bangla', /\bbangla\b(?!\s*(?:medium|version))|বাংলা(?!\s*(?:মাধ্যম|ভার্সন))/],
  ['Physics', /\bphysics\b|পদার্থ/], ['Chemistry', /\bchemistry\b|রসায়ন|রসায়ন/],
  ['Biology', /\bbiology\b|জীববিজ্ঞান/], ['Science', /\bscience\b|বিজ্ঞান/],
  ['All subjects', /all subjects|সব বিষয়|সব বিষয়/]
];

// Intentionally bounded vocabulary: unknown locations are not guessed.
const areas = [
  ['Mirpur', /\bmirpur(?:\s*[- ]?\s*\d{1,2})?\b|মিরপুর(?:\s*[- ]?\s*\d{1,2})?/],
  ['Dhanmondi', /\bdhanmondi\b|ধানমন্ডি/], ['Uttara', /\buttara\b|উত্তরা/],
  ['Mohammadpur', /\bmohammadpur\b|মোহাম্মদপুর/], ['Bashundhara', /\bbashundhara\b|বসুন্ধরা/]
];

export function extract(text, lastQuestion = null) {
  const t = normalize(text);
  const fields = {}, ambiguities = [];
  const put = (field, values) => {
    const unique = [...new Set(values)];
    if (unique.length > 1) ambiguities.push(field);
    else if (unique.length) fields[field] = unique[0];
  };
  const classes = [...t.matchAll(/(?:class|grade|ক্লাস|শ্রেণি|শ্রেণী)\s*[:=-]?\s*([a-z]+|\d+|[\u0980-\u09ff]+)/g)]
    .map(m => Number(m[1]) || classWords[m[1]]).filter(Boolean);
  for (const [word, n] of Object.entries(classWords)) {
    if (/[\u0980-\u09ff]/.test(word) && t.includes(`${word} শ্রেণি`)) classes.push(n);
  }
  if (classes.some(n => n < 1 || n > 12)) ambiguities.push('class');
  else put('class', classes);

  const mediums = [];
  if (/english\s*medium|ইংলিশ\s*মিডিয়াম|ইংলিশ\s*মিডিয়াম|ইংরেজি\s*মাধ্যম/.test(t)) mediums.push('English Medium');
  if (/english\s*version|ইংলিশ\s*ভার্সন|ইংরেজি\s*ভার্সন/.test(t)) mediums.push('English Version');
  if (/bangla\s*medium|বাংলা\s*মাধ্যম/.test(t)) mediums.push('Bangla Medium');
  put('medium', mediums);

  const subjects = subjectPatterns.filter(([, p]) => p.test(t)).map(([name]) => name);
  // Biology/Physics mentions can contain generic বিজ্ঞান; keep explicit subjects.
  if (subjects.includes('Biology') && subjects.includes('Science')) subjects.splice(subjects.indexOf('Science'), 1);
  if (subjects.length) fields.subject = subjects.join(', ');

  put('area', areas.flatMap(([name, p]) => {
    return [...t.matchAll(new RegExp(p.source, 'g'))].map(match => {
      const part = name === 'Mirpur' ? match[0].match(/\d+/)?.[0] : null;
      return part ? `${name} ${part}` : name;
    });
  }));

  const genders = [];
  if (/female|মহিলা|নারী|মেয়ে টিউটর|মেয়ে টিউটর|মেয়ে শিক্ষক|মেয়ে শিক্ষক/.test(t)) genders.push('Female');
  if (/\bmale\b|পুরুষ|ছেলে টিউটর|ছেলে শিক্ষক/.test(t)) genders.push('Male');
  if (/no preference|any gender|any tutor|যেকোনো|যে কোনো|পছন্দ নেই/.test(t)) genders.push('No preference');
  put('genderPreference', genders);

  const days = [...t.matchAll(/(\d+)\s*(?:দিন|din\b|days?\b)/g)].map(m => Number(m[1]));
  if (days.some(n => n < 1 || n > 7)) ambiguities.push('daysPerWeek');
  else put('daysPerWeek', days);

  const amounts = [...t.matchAll(/(?:budget|salary|বাজেট|বেতন)\s*[:=-]?\s*(\d[\d,]*)\s*(k\b|হাজার|hajar\b|hazar\b|thousand\b)?/g)]
    .map(m => Number(m[1].replaceAll(',', '')) * (m[2] ? 1000 : 1));
  if (amounts.some(n => n <= 0)) ambiguities.push('salaryBudget');
  else put('salaryBudget', amounts);
  if (/(?:\d)\s*(?:-|থেকে|to)\s*\d/.test(t) && /budget|salary|বাজেট|বেতন/.test(t)) ambiguities.push('salaryBudget');

  if (lastQuestion && !Object.keys(fields).length && !ambiguities.length) {
    const number = /^\d+$/.test(t) ? Number(t) : null;
    if (lastQuestion === 'class' && number >= 1 && number <= 12) fields.class = number;
    if (lastQuestion === 'daysPerWeek' && number >= 1 && number <= 7) fields.daysPerWeek = number;
    if (lastQuestion === 'salaryBudget') {
      const m = t.match(/^(\d[\d,]*)\s*(k|হাজার|hajar|hazar|thousand|টাকা)?[।.]?$/);
      if (m) {
        const n = Number(m[1].replaceAll(',', '')) * (/k|হাজার|hajar|hazar|thousand/.test(m[2] || '') ? 1000 : 1);
        if (n > 0) fields.salaryBudget = n;
      }
    }
  }
  // Negations and alternatives require clarification, rather than selecting a value.
  if (/\b(?:not|or)\b|নয়|নয়|না[,।\s]|নাকি|অথবা/.test(t)) {
    for (const field of Object.keys(fields)) ambiguities.push(field);
  }
  for (const field of new Set(ambiguities)) delete fields[field];
  const job = t.match(/(?:job\s*(?:id|#)|জব\s*আইডি)\s*[:#=-]?\s*([a-z0-9-]+)/i);
  return { fields, ambiguities: [...new Set(ambiguities)], jobId: job?.[1] ?? null };
}
