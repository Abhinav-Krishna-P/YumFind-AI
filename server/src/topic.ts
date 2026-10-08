import { topicAllowed } from './gemini.js';
import { kvGet, kvSet } from './kv.js';
import { normalize } from './memory.js';
import { HttpError } from './types.js';

// The gate's verdict for a phrasing does not change, so each one costs at most one model call a day.
const GATE_TTL = 24 * 60 * 60;

const REJECT = 'YumFindAI only answers food, restaurant, and hotel questions';

const HOSPITALITY =
  /\b(restaurant|restaurants|hotel|hotels|cafe|cafes|coffee|tea|food|eat|eating|dish|dishes|meal|meals|lunch|dinner|breakfast|brunch|snack|hungry|cuisine|dining|bakery|buffet|thali|veg|vegetarian|spicy|mandi|mandhi|manthi|biryani|biriyani|dosa|idli|pizza|burger|chicken|mutton|beef|fish|seafood|rice|noodle|noodles|chinese|indian|arabic|kebab|shawarma|grill|bar|pub|dessert|sweet|sweets|juice|icecream|kitchen|lodge|resort|stay|stays|room|rooms|homestay|inn|porotta|parotta|alfaham|tandoori|curry|soup|salad|fries|sandwich|pasta|sushi|ramen|momo|chaat|paneer|dal|roti|naan|cake|pastry|milkshake|smoothie|breakfast|supper|cuisine)\b/i;

const FOLLOW_UP =
  /\b(closer|closest|close|near|nearest|far|road|drive|driving|minutes|cheaper|cheapest|cheap|budget|price|pricey|expensive|parking|outdoor|seating|rating|rated|review|reviews|distance|walking|walk|taste|tasty|flavour|flavor|portion|portions|service|clean|hygiene|crowd|crowded|busy|quiet|takeaway|delivery|dine|family|families|kids|children|group|friends|date|couple|ambience|ambiance|vibe|open|hours|late|which|best|better|recommend|pick|choose|less|more|mild|hot)\b/i;

const OFF_TOPIC =
  /\b(python|javascript|typescript|programming|homework|weather|forecast|stock|crypto|bitcoin|president|prime minister|capital of|translate|poem|lyrics|song|equation|password|hack|exploit|malware|movie|cricket|football|news|who won|write code|write a)\b/i;

function onTopic(text: string, mode: 'search' | 'followup') {
  if (HOSPITALITY.test(text)) return true;
  return mode === 'followup' && FOLLOW_UP.test(text);
}

export async function assertHospitality(text: string, mode: 'search' | 'followup') {
  const message = text.trim();
  if (!message) throw new HttpError(400, REJECT);
  if (OFF_TOPIC.test(message)) throw new HttpError(400, REJECT);
  if (onTopic(message, mode)) return;
  const key = `gate:${mode}|${normalize(message)}`;
  const known = await kvGet<boolean>(key);
  if (known !== null) {
    if (!known) throw new HttpError(400, REJECT);
    return;
  }
  let allowed: boolean;
  try {
    allowed = await topicAllowed(message, mode);
    await kvSet(key, allowed, GATE_TTL);
  } catch (error) {
    console.error('[topic] gate unavailable', error instanceof Error ? error.message : error);
    // The gate is a courtesy filter. A follow-up can only be answered from places already on the map, so let it through.
    allowed = mode === 'followup';
  }
  if (!allowed) throw new HttpError(400, REJECT);
}
