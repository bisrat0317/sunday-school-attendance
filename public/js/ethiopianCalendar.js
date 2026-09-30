// Ethiopian Calendar & Time Converter Utility
// Based on exact Julian Day Number (JDN) algorithms

const ETHIOPIC_MONTHS_AM = [
  'መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት',
  'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'
];

const ETHIOPIC_MONTHS_EN = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'
];

// Gregorian YYYY-MM-DD -> JDN
function gregorianToJdn(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

// JDN -> Ethiopian { year, month, day }
function jdnToEthiopic(jdn) {
  const ERA = 1723856;
  const r = (jdn - ERA) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year = 4 * Math.floor((jdn - ERA) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460);
  const month = Math.floor(n / 30) + 1;
  const day = (n % 30) + 1;
  return { year, month, day };
}

// Ethiopian { year, month, day } -> JDN
function ethiopicToJdn(year, month, day) {
  const ERA = 1723856;
  return ERA + 365 * (year - 1) + Math.floor(year / 4) + 30 * (month - 1) + day - 1;
}

// JDN -> Gregorian { year, month, day }
function jdnToGregorian(jdn) {
  const f = jdn + 1401 + Math.floor((Math.floor((4 * jdn + 274274) / 146097) * 3) / 4) - 38;
  const e = 4 * f + 3;
  const g = Math.floor((e % 1461) / 4);
  const h = 5 * g + 2;
  const day = Math.floor((h % 153) / 5) + 1;
  const month = ((Math.floor(h / 153) + 2) % 12) + 1;
  const year = Math.floor(e / 1461) - 4716 + Math.floor((14 - month) / 12);
  return { year, month, day };
}

// Public API: Convert Gregorian ISO string (YYYY-MM-DD) to Ethiopic Object
function toEthiopicDate(gregorianDateStr) {
  if (!gregorianDateStr) return null;
  const parts = String(gregorianDateStr).split('T')[0].split('-');
  if (parts.length < 3) return null;
  const gYear = parseInt(parts[0], 10);
  const gMonth = parseInt(parts[1], 10);
  const gDay = parseInt(parts[2], 10);
  if (isNaN(gYear) || isNaN(gMonth) || isNaN(gDay)) return null;

  const jdn = gregorianToJdn(gYear, gMonth, gDay);
  return jdnToEthiopic(jdn);
}

// Public API: Convert Ethiopic (year, month, day) to Gregorian YYYY-MM-DD string
function toGregorianDateStr(eYear, eMonth, eDay) {
  const jdn = ethiopicToJdn(parseInt(eYear, 10), parseInt(eMonth, 10), parseInt(eDay, 10));
  const g = jdnToGregorian(jdn);
  const yyyy = String(g.year).padStart(4, '0');
  const mm = String(g.month).padStart(2, '0');
  const dd = String(g.day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Format date for UI based on language ('am' or 'en')
function formatAppDate(gregorianDateStr, lang = 'am') {
  if (!gregorianDateStr) return '';
  const ethObj = toEthiopicDate(gregorianDateStr);
  if (!ethObj) return String(gregorianDateStr);

  if (lang === 'am') {
    const monthName = ETHIOPIC_MONTHS_AM[ethObj.month - 1] || '';
    return `${monthName} ${ethObj.day}, ${ethObj.year} ዓ.ም.`;
  } else {
    const monthName = ETHIOPIC_MONTHS_EN[ethObj.month - 1] || '';
    return `${monthName} ${ethObj.day}, ${ethObj.year} E.C.`;
  }
}

// Convert 24-hr HH:MM string to Ethiopian Time Object
function parseStandardTimeToEth(timeStr) {
  if (!timeStr) return { hour: 3, min: '00', period: 'morning' };
  const cleanStr = String(timeStr).trim().split('-')[0].trim();
  const parts = cleanStr.split(':');
  if (parts.length < 2) return { hour: 3, min: '00', period: 'morning' };

  let h = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10);
  if (isNaN(h)) h = 9;
  if (isNaN(m)) m = 0;

  const mStr = String(m).padStart(2, '0');

  let period = 'morning';
  let ethH = 12;

  if (h >= 6 && h < 12) {
    period = 'morning';
    ethH = h - 6 === 0 ? 12 : h - 6;
  } else if (h >= 12 && h < 18) {
    period = 'daytime';
    ethH = h - 12 === 0 ? 12 : h - 12;
  } else if (h >= 18 && h < 24) {
    period = 'evening';
    ethH = h - 18 === 0 ? 12 : h - 18;
  } else {
    period = 'night';
    ethH = h === 0 ? 12 : h;
  }

  return { hour: ethH, min: mStr, period };
}

// Convert Ethiopian Time selection (hour 1-12, min 00-59, period) to 24-hr HH:MM string
function ethTimeToStandard(ethH, minStr, period) {
  let h = parseInt(ethH, 10);
  const m = String(minStr).padStart(2, '0');

  let stdH = 0;
  if (period === 'morning') { // ከጠዋቱ
    stdH = (h % 12) + 6;
  } else if (period === 'daytime') { // ከቀኑ
    stdH = (h % 12) + 12;
  } else if (period === 'evening') { // ከምሽቱ
    stdH = (h % 12) + 18;
  } else if (period === 'night') { // ከሌሊቱ
    stdH = h % 12;
  }

  return `${String(stdH).padStart(2, '0')}:${m}`;
}

// Format time string (e.g. "09:00 - 11:00" or "09:00") for UI in Ethiopian or Standard format
function formatAppTime(timeStr, lang = 'am') {
  if (!timeStr) return '';
  const rangeParts = String(timeStr).split('-').map(s => s.trim());

  const periodLabelsAm = {
    morning: 'ከጠዋቱ',
    daytime: 'ከቀኑ',
    evening: 'ከምሽቱ',
    night: 'ከሌሊቱ'
  };

  const periodLabelsEn = {
    morning: 'Morning',
    daytime: 'Afternoon',
    evening: 'Evening',
    night: 'Night'
  };

  const startEth = parseStandardTimeToEth(rangeParts[0]);

  if (rangeParts.length > 1) {
    const endEth = parseStandardTimeToEth(rangeParts[1]);

    if (lang === 'am') {
      const pLabel = periodLabelsAm[startEth.period] || 'ከጠዋቱ';
      return `${pLabel} ${startEth.hour}:${startEth.min} - ${endEth.hour}:${endEth.min} ሰዓት`;
    } else {
      const pLabel = periodLabelsEn[startEth.period] || 'Morning';
      return `${startEth.hour}:${startEth.min} - ${endEth.hour}:${endEth.min} (${pLabel})`;
    }
  } else {
    if (lang === 'am') {
      const pLabel = periodLabelsAm[startEth.period] || 'ከጠዋቱ';
      return `${pLabel} ${startEth.hour}:${startEth.min} ሰዓት`;
    } else {
      const pLabel = periodLabelsEn[startEth.period] || 'Morning';
      return `${startEth.hour}:${startEth.min} (${pLabel})`;
    }
  }
}
