// Reads the structure of a Korean mobile data plan from its marketed name, e.g.
// "[A모바일]A 스페셜 11GB+", "LTE 15GB+/100분", "월 11GB+일2GB+3Mbps", "데이터 무제한 5Mbps".
// Values the name states are taken as-is; values a bare "+" only implies are filled with
// the usual MVNO structure and listed in `guessed` so the form can ask the user to check them.

const NUMBER = '(\\d+(?:\\.\\d+)?)';
const DAILY = new RegExp(`(?:매일|하루|일)\\s*${NUMBER}\\s*(GB|G|기가|MB)`, 'i');
const SPEED = new RegExp(`${NUMBER}\\s*(Mbps|M|Kbps|K)(?![a-z가-힣])`, 'i');
const AMOUNT = new RegExp(`${NUMBER}\\s*(GB|G|기가|MB)(?![a-z])(\\s*\\+)?`, 'gi');
// "무제한" about data, not about calls or texts ("통화 무제한", "음성 무제한").
const DATA_UNLIMITED = /(?<!통화|음성|문자|전화)\s*(?:데이터\s*)?(?:무제한|무한)/;
const CALL_UNLIMITED = /(통화|음성|문자|전화)\s*(무제한|무한)/g;

const toGB = (value, unit) => (/mb/i.test(unit) ? Number(value) / 1024 : Number(value));
const toMbps = (value, unit) => (/^k/i.test(unit) ? Number(value) / 1000 : Number(value));
const round = value => Math.round(value * 100) / 100;

// Speed of the unlimited tail when the name only says "+": larger plans throttle faster.
const usualThrottleMbps = monthlyGB => (monthlyGB >= 100 ? 5 : monthlyGB >= 10 ? 3 : 1);

export function parsePlanName(input) {
  const text = String(input || '').trim();
  const result = { carrierName: '', planName: text, guessed: [] };
  if (!text) return result;

  const carrier = /^\s*[[(]([^\])]{1,30})[\])]\s*/.exec(text);
  if (carrier) {
    result.carrierName = carrier[1].trim();
    result.planName = text.slice(carrier[0].length).trim() || text;
  }

  const daily = DAILY.exec(text);
  if (daily) result.dailyBonusGB = round(toGB(daily[1], daily[2]));

  // The monthly allowance is the first amount that is not the daily top-up.
  let plus = false;
  for (const match of text.matchAll(AMOUNT)) {
    if (daily && match.index >= daily.index && match.index < daily.index + daily[0].length) continue;
    result.monthlyLimitGB = round(toGB(match[1], match[2]));
    plus = Boolean(match[3]);
    break;
  }

  const speed = SPEED.exec(text.replace(AMOUNT, ' '));
  if (speed) result.throttleMbps = round(toMbps(speed[1], speed[2]));

  const unlimited = DATA_UNLIMITED.test(text.replace(CALL_UNLIMITED, ' '));
  if (speed || plus || unlimited) {
    result.afterLimit = 'throttled';
    if (result.throttleMbps === undefined) {
      result.throttleMbps = usualThrottleMbps(result.monthlyLimitGB || 0);
      result.guessed.push('throttleMbps');
    }
    // "11GB+" is widely sold as 11GB + 2GB a day + 3Mbps; only that bare form implies a top-up.
    if (result.dailyBonusGB === undefined && plus && result.monthlyLimitGB === 11 && !speed) {
      result.dailyBonusGB = 2;
      result.guessed.push('dailyBonusGB');
    }
  } else if (result.monthlyLimitGB !== undefined) {
    result.afterLimit = 'blocked';
  }
  return result;
}

// One line describing the plan structure, e.g. "월 11GB + 매일 2GB, 이후 3Mbps 무제한".
export function describePlan(profile) {
  const parts = [`월 ${round(Number(profile?.monthlyLimitGB) || 0)}GB`];
  if (Number(profile?.dailyBonusGB) > 0) parts.push(`매일 ${round(Number(profile.dailyBonusGB))}GB`);
  const head = parts.join(' + ');
  if (profile?.afterLimit === 'throttled') {
    const mbps = Number(profile.throttleMbps);
    return `${head}, 이후 ${mbps > 0 ? `${round(mbps)}Mbps ` : '속도 제한 '}무제한`;
  }
  return `${head}, 다 쓰면 차단되거나 추가 요금`;
}
