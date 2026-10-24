export const GUARDIAN_FIELDS = Object.freeze([
  'class', 'subject', 'area', 'medium', 'genderPreference', 'daysPerWeek', 'salaryBudget'
]);

export const QUESTIONS = Object.freeze({
  class: 'শিক্ষার্থী কোন শ্রেণিতে পড়ে?',
  subject: 'কোন বিষয় পড়ানোর জন্য টিউটর প্রয়োজন?',
  area: 'কোন এলাকায় টিউটর প্রয়োজন?',
  medium: 'বাংলা মাধ্যম, English Medium নাকি English Version?',
  genderPreference: 'টিউটরের gender নিয়ে কোনো পছন্দ আছে, নাকি যেকোনোটি চলবে?',
  daysPerWeek: 'সপ্তাহে কয় দিন পড়াতে হবে?',
  salaryBudget: 'মাসিক বেতনের বাজেট কত টাকা?'
});

// Only policies explicitly supplied by the owner. No availability or guarantees.
export const COMMISSION_REPLY = 'কমিশন প্রথম মাসের বেতনের ৫০%, টিউটর সেই বেতন পাওয়ার পরে প্রদান করবেন।';
export const FORM_REPLY = 'টিউটর নিবন্ধনের জন্য Google Form পূরণ করতে হবে। অনুমোদিত Form link এখানে সেট করা নেই; লিংক ও CV/student ID জমা দেওয়ার নির্দেশনার জন্য মানুষের সহায়তা প্রয়োজন।';
export const FALLBACK_REPLY = 'আমি নিশ্চিতভাবে বুঝতে পারিনি। আপনি কি টিউটর খুঁজছেন, নাকি টিউটর হিসেবে জানতে চাইছেন?';
