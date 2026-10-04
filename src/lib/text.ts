/** Lightweight clinical-text helpers: negation-aware term detection for free-text notes. */

export type Mention = 'positive' | 'negated' | 'absent';

const NEG_CUE = /\b(no|not|denies|denied|deny|denying|without|negative for|free of|nor|absence of|absent|never|ruled out|r\/o)\b|\bw\/o\b|-ve\b/i;
const CLAUSE_BREAK = /[.;:\n!?]|\bbut\b|\bhowever\b|\balthough\b|\bexcept\b|\bthough\b/i;

/** True when the match at `idx` sits in a negated clause ("denies fever, chills…"). */
export function negatedAt(text: string, idx: number): boolean {
  const parts = text.slice(Math.max(0, idx - 160), idx).split(CLAUSE_BREAK);
  return NEG_CUE.test(parts[parts.length - 1]);
}

/** Finds the first non-negated occurrence of `term` (global flag added internally). */
export function mention(text: string, term: RegExp): Mention {
  if (!text) return 'absent';
  const re = new RegExp(term.source, term.flags.includes('g') ? term.flags : term.flags + 'g');
  let sawNegated = false;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    // Look back to the start of the clause.
    const before = text.slice(Math.max(0, idx - 160), idx);
    const parts = before.split(CLAUSE_BREAK);
    const clause = parts[parts.length - 1];
    // Negation also applies to "-ve" right after the term (e.g. "urine pregnancy test is -ve").
    const after = text.slice(idx + m[0].length, idx + m[0].length + 12);
    if (NEG_CUE.test(clause) || /^\s*(is\s+)?(-ve|negative|absent)\b/i.test(after)) sawNegated = true;
    else return 'positive';
  }
  return sawNegated ? 'negated' : 'absent';
}

export const has = (text: string, term: RegExp) => mention(text, term) === 'positive';

export const TERMS = {
  feverPos: /\b(febrile|fever(ish)?|pyrexi\w*|hyperthermi\w*|high[- ]grade (fever|temp\w*)|high temp\w*|hotness of body)\b/i,
  feverMeasuredHigh: /\b(febrile|pyrexi\w*|high[- ]grade|temp(erature)?\s*(of|was|is|:)?\s*(3[89]|4[0-2])(\.\d)?)\b/i,
  feverReported: /(history of|h\/o|hx of|reported|subjective|at home|on and off|intermittent|low[- ]grade|took (paracetamol|panadol|adol|antipyretic|ibuprofen)|antipyretic)/i,
  afebrile: /\bafebrile\b|\bno fever\b|\bdenie[sd] fever\b|\bwithout fever\b/i,
  tachycardia: /\btachycardi\w*\b|\bpalpitation\w*\b|\bracing heart\b|\bhr\s*(1[0-9]\d)/i,
  bradycardia: /\bbradycardi\w*\b/i,
  tachypnea: /\btachypn\w*\b|\brespiratory distress\b|\bshortness of breath\b|\bsob\b|\bdyspn\w*\b|\bdifficulty (in )?breathing\b|\blabou?red breathing\b|\bchest (in|retraction|recession)\w*/i,
  hypotension: /\bhypotens\w*\b|\bshock\b|\bcollapse\w*\b|\blow (blood pressure|bp)\b/i,
  hypertension: /\bhypertens\w*\b|\bhtn\b|\bhigh (blood pressure|bp)\b|\bhypertensive\b/i,
  dehydration: /\bdehydrat\w*\b|\bdry (mucosa|mouth|tongue|lips)\b|\bsunken eyes?\b|\bpoor (oral )?intake\b|\breduced urine\b|\boliguri\w*\b/i,
  hypoxia: /\bhypoxi\w*\b|\bdesaturat\w*\b|\bcyanos\w*\b|\bspo2\s*(8\d|9[0-3])\b/i,
  pregnant: /\bpregnan\w*\b|\bgestation\w*\b|\b\d+\s*(wks?|weeks)\s*(pregnant|gestation|ga)\b|\bG\d+\s*P\d+|\bANC\b|\bPG\b|antenatal/i,
  trauma: /\b(injur\w*|trauma\w*|fell|fall(ing|en)?|slipped|twist\w*|sprain\w*|rta|accident\w*|hit by|struck|laceration\w*|cut (by|with|wound)|wound\w*|burn(s|ed|t)?\b|bitten|bite by|dog bite|cat bite|crush\w*|collision|fractur\w*|contusion\w*|bruis\w*|assault\w*|stab\w*|road traffic|mva|motor vehicle)\b/i,
  mechanism: /\b(fell|fall(ing|en)?|slipped|twist\w*|hit by|hit (his|her|the)|struck|collision|rta|road traffic|mva|car|motor|bike|bicycle|cut (by|with)|knife|glass|blade|hot (water|oil|tea|coffee|drink|object|liquid)|coffee|tea|scald\w*|boiling|flame|fire|bitten|bite by|dog|cat|crush\w*|lifting|lifted|heavy (object|weight)|sport\w*|football|playing|play\w*|kick\w*|punch\w*|assault\w*|fight|machine|tool|nail|stairs|ladder|jump\w*|ran into|bumped|door|caught)\b/i,
  when: /\b(today|yesterday|tonight|this (morning|evening|afternoon)|last (night|week)|\d+\s*(min(ute)?s?|hours?|hrs?|days?|weeks?|wks?|months?)\s*(ago|back|prior)|since \d|since (yesterday|morning|last)|at \d{1,2}(:\d{2})?\s*(am|pm)?|on \d{1,2}[\/-]\d{1,2}|on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)|one (hour|day|week) ago|(\d+|one|two|three|few) (days?|hours?|weeks?) (history|ago)|for \d+\s*(days?|hours?|weeks?)|\d+\s*(days?|hours?|weeks?)\s*(history|duration))\b/i,
  where: /\b(at|in|on|inside|outside) (the )?(home|house|school|work|workplace|office|street|road|playground|park|gym|mosque|market|mall|kitchen|bathroom|stairs|garden|farm|site|factory|car|bus|club|stadium|field|beach|desert|camp|restaurant|shop|store|room|bed|toilet)\b|\bat home\b|\bat school\b|\bat work\b|\bwhile (driving|playing|working|cooking|walking|running|cleaning)\b/i,
  workStatus: /\b(not work[- ]related|non[- ]work[- ]related|not (an )?occupational|work[- ]related|occupational|at work|on duty|during work|workplace|work injury|gosi)\b/i,
  workPositive: /\b(work[- ]related|occupational (injury|accident)|at work|on duty|during (his |her )?(work|shift)|workplace|work injury|at (the )?(site|factory|construction))\b/i,
  workNegative: /\b(not work[- ]related|non[- ]work[- ]related|not (an )?occupational|not at work|outside work)\b/i,
  rta: /\b(rta|road traffic|motor vehicle|mva|car (accident|crash|collision)|hit by (a )?car|vehicle collision)\b/i,
  assault: /\b(assault\w*|fight|beaten|stab\w*|attacked)\b/i,
  duration: /\b(since|for|x)\s*\d+|\b\d+(\.\d+)?\s*(-\s*\d+\s*)?(min(ute)?s?|hours?|hrs?|h|days?|d|weeks?|wks?|months?|mons?|years?|yrs?)\b|\b(yesterday|today|this morning|last night|tonight|one|two|three|four|five|six|seven|few|several|couple of)\s+(days?|weeks?|months?|hours?|years?)\b|\b(yesterday|today|this morning|last night|tonight)\b|\bchronic\b|\brecurrent\b|\bsince (childhood|birth|long|years)\b|\bacute\b/i,
  exam: /\bo\/e\b|\bon (examination|exam)\b|\bexamination\b|\bexam(ined)?\b|\bchest (is )?clear\b|\bauscultat\w*\b|\btender(ness)?\b|\bthroat (is )?(congested|red|hyperaemic|hyperemic|inflamed)\b|\btonsils? (are |is )?(enlarged|congested|inflamed|grade|hypertroph)|\babdomen (is )?(soft|lax|distended|tender)\b|\bbowel sounds?\b|\bear ?drum\b|\btympanic membrane\b|\botoscop\w*\b|\bvesicular\b|\bcrepitation\w*\b|\bair entry\b|\bgcs\b|\breflex\w*\b|\bpupils?\b|\bconscious\b|\boriented\b|\bcapillary refill\b|\bpalpat\w*\b|\bmurmur\b|\bs1\b|\bs2\b|\blymph ?nodes?\b|\blymphadenopathy\b|\bspeculum\b|\bpv\b|\bpercussion\b|\bmobility\b|\bpocket depth\b|\bprobing\b|\bcaries\b|\bcavity\b|\bswelling (of|over|at)\b|\berythema\w*\b|\bedema\b|\boedema\b|\brange of motion\b|\brom\b|\bsle?r\b|\bstraight leg\b|\bhydration\b|\bhydrated\b|\bfundal height\b|\bfetal heart\b|\bfhr\b|\bvisual acuity\b|\bfindings?\b/i,
  plan: /\bplan\b|\badvi[sc]ed?\b|\bprescrib\w*\b|\bgiven\b|\bstart(ed)? on\b|\btreat(ed|ment)? with\b|\bfollow[- ]?up\b|\bf\/u\b|\breview (in|after)\b|\brefer(red|ral)?\b|\bdischarg\w*\b|\badmi(t|tted|ssion)\b|\bcounsel\w*\b|\brx\b|\bwe will\b|\bmanagement\b|\brequest(ed)?\b|\border(ed)?\b|\bto (do|start|continue|take)\b|\bcontinue\b|\bnebuli[sz]ed\b|\binvestigations?\b/i,
  severity: /\bsever\w*\b|\bmoderate\w*\b|\bmild\b|\bintense\b|\bexcruciating\b|\bunbearable\b|\bintractable\b|\b\d{1,2}\s*\/\s*10\b|\bpain score\b|\bvas\b|\bgrade (i{1,3}|iv|[1-4])\b|\bunable to\b|\bdistress\w*\b|\bpersistent vomit\w*\b|\brepeated vomit\w*\b|\bnot tolerat\w*\b|\bfailed oral\b|\bnot respond\w*\b|\bworsen\w*\b|\bprogressive\w*\b/i,
  severeOnly: /\bsever\w*\b|\bsevir\w*\b|\bsver\w*\b|\bintense\b|\bexcruciating\b|\bunbearable\b|\bintractable\b|\b([7-9]|10)\s*\/\s*10\b|\bunable to (tolerate|keep|swallow|walk|move|sleep|eat|drink)\b|\bdistress\w*\b|\bpersistent vomit\w*\b|\brepeated vomit\w*\b|\bmultiple (episodes|times)\b|\bnot tolerat\w*\b|\bfailed oral\b|\bnot respond\w*\b|\bno (response|improvement)\b|\bdehydrat\w*\b|\bacute attack\b|\bvomit\w*\b/i,
};

export function snippet(text: string, term: RegExp, radius = 60): string {
  const m = text.match(term);
  if (!m || m.index === undefined) return '';
  const s = Math.max(0, m.index - radius);
  const e = Math.min(text.length, m.index + m[0].length + radius);
  return (s > 0 ? '…' : '') + text.slice(s, e).trim() + (e < text.length ? '…' : '');
}
