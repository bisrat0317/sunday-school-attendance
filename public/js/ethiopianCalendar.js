// Ethiopian Calendar & Time Converter Utility using official 'kenat' package API

const ETHIOPIC_MONTHS_AM = typeof Kenat !== 'undefined' && Kenat.monthNames ? Kenat.monthNames.amharic : [
  'መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት',
  'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'
];

const ETHIOPIC_MONTHS_EN = typeof Kenat !== 'undefined' && Kenat.monthNames ? Kenat.monthNames.english : [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'
];

// Public API: Convert Gregorian ISO string (YYYY-MM-DD) to Ethiopic Object using Kenat.toEC
function toEthiopicDate(gregorianDateStr) {
  if (!gregorianDateStr) return null;
  const parts = String(gregorianDateStr).split('T')[0].split('-');
  if (parts.length < 3) return null;
  const gYear = parseInt(parts[0], 10);
  const gMonth = parseInt(parts[1], 10);
  const gDay = parseInt(parts[2], 10);
  if (isNaN(gYear) || isNaN(gMonth) || isNaN(gDay)) return null;

  try {
    if (typeof Kenat !== 'undefined' && typeof Kenat.toEC === 'function') {
      return Kenat.toEC(gYear, gMonth, gDay);
    }
  } catch (e) {
    console.error('Kenat.toEC error:', e);
  }
  return null;
}

// Public API: Convert Ethiopic (year, month, day) to Gregorian YYYY-MM-DD string using Kenat.toGC
function toGregorianDateStr(eYear, eMonth, eDay) {
  try {
    if (typeof Kenat !== 'undefined' && typeof Kenat.toGC === 'function') {
      const g = Kenat.toGC(parseInt(eYear, 10), parseInt(eMonth, 10), parseInt(eDay, 10));
      const yyyy = String(g.year).padStart(4, '0');
      const mm = String(g.month).padStart(2, '0');
      const dd = String(g.day).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  } catch (e) {
    console.error('Kenat.toGC error:', e);
  }
  return '';
}

// Format date for UI based on language ('am' or 'en')
function formatAppDate(gregorianDateStr, lang = 'am') {
  if (!gregorianDateStr) return '';
  const ethObj = toEthiopicDate(gregorianDateStr);
  if (!ethObj) return String(gregorianDateStr);

  const monthsArr = lang === 'am' ? ETHIOPIC_MONTHS_AM : ETHIOPIC_MONTHS_EN;
  const monthName = monthsArr[ethObj.month - 1] || '';
  const suffix = lang === 'am' ? 'ዓ.ም.' : 'E.C.';

  return `${monthName} ${ethObj.day}, ${ethObj.year} ${suffix}`;
}

// Convert 24-hr HH:MM string to Ethiopian Time using Kenat.Time
function parseStandardTimeToEth(timeStr) {
  if (!timeStr) return { hour: 3, min: '00', period: 'day' };
  const cleanStr = String(timeStr).trim().split('-')[0].trim();
  const parts = cleanStr.split(':');
  if (parts.length < 2) return { hour: 3, min: '00', period: 'day' };

  let h = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10);
  if (isNaN(h)) h = 9;
  if (isNaN(m)) m = 0;

  try {
    if (typeof Kenat !== 'undefined' && Kenat.Time && typeof Kenat.Time.fromGregorian === 'function') {
      const kTime = Kenat.Time.fromGregorian(h, m);
      return {
        hour: kTime.hour,
        min: String(kTime.minute).padStart(2, '0'),
        period: kTime.period // 'day' or 'night'
      };
    }
  } catch (e) {
    console.error('Kenat.Time error:', e);
  }

  return { hour: 3, min: '00', period: 'day' };
}

// Convert 24-hr HH:MM to 12-hr AM/PM string
function formatStandard12Hr(time24) {
  if (!time24) return '';
  const parts = String(time24).trim().split(':');
  if (parts.length < 2) return time24;
  let h = parseInt(parts[0], 10);
  const m = parts[1] || '00';
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

// Format time string (e.g. "09:00 - 11:00" or "09:00") for UI using Kenat Time formatting
function formatAppTime(timeStr, lang = 'am') {
  if (!timeStr) return '';
  const rangeParts = String(timeStr).split('-').map(s => s.trim());

  function formatSingleTime(stdTime24, isAmharic) {
    const parts = stdTime24.split(':');
    let h = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    if (isNaN(h)) h = 9;
    if (isNaN(m)) m = 0;

    if (isAmharic) {
      if (typeof Kenat !== 'undefined' && Kenat.Time && typeof Kenat.Time.fromGregorian === 'function') {
        const kTime = Kenat.Time.fromGregorian(h, m);
        let periodLabel = 'ከጠዋቱ';
        if (h >= 6 && h < 12) periodLabel = 'ከጠዋቱ';
        else if (h >= 12 && h < 18) periodLabel = 'ከቀኑ';
        else if (h >= 18 && h < 24) periodLabel = 'ከምሽቱ';
        else periodLabel = 'ከሌሊቱ';

        const minStr = String(kTime.minute).padStart(2, '0');
        return `${periodLabel} ${kTime.hour}:${minStr} ሰዓት`;
      }
    }
    return formatStandard12Hr(stdTime24);
  }

  const isAmharic = lang === 'am';

  if (rangeParts.length > 1) {
    if (isAmharic) {
      const startEth = parseStandardTimeToEth(rangeParts[0]);
      const endEth = parseStandardTimeToEth(rangeParts[1]);
      let hStart = parseInt(rangeParts[0].split(':')[0], 10);
      let pLabel = 'ከጠዋቱ';
      if (hStart >= 6 && hStart < 12) pLabel = 'ከጠዋቱ';
      else if (hStart >= 12 && hStart < 18) pLabel = 'ከቀኑ';
      else if (hStart >= 18 && hStart < 24) pLabel = 'ከምሽቱ';
      else pLabel = 'ከሌሊቱ';

      return `${pLabel} ${startEth.hour}:${startEth.min} - ${endEth.hour}:${endEth.min} ሰዓት`;
    } else {
      const start12 = formatStandard12Hr(rangeParts[0]);
      const end12 = formatStandard12Hr(rangeParts[1]);
      return `${start12} - ${end12}`;
    }
  } else {
    return formatSingleTime(rangeParts[0], isAmharic);
  }
}
