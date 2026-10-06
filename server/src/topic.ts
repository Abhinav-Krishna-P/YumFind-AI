import { topicAllowed } from './gemini.js';
import { HttpError } from './types.js';

const REJECT = 'YumFindAI only answers food, restaurant, and hotel questions';

const HOSPITALITY =
  /\b(restaurant|restaurants|hotel|hotels|cafe|cafes|coffee|tea|food|eat|eating|dish|dishes|meal|meals|lunch|dinner|breakfast|brunch|snack|hungry|cuisine|dining|bakery|buffet|thali|veg|vegetarian|spicy|mandi|mandhi|manthi|biryani|biriyani|dosa|idli|pizza|burger|chicken|mutton|beef|fish|seafood|rice|noodle|noodles|chinese|indian|arabic|kebab|shawarma|grill|bar|pub|dessert|sweet|sweets|juice|icecream|kitchen|lodge|resort|stay|stays|room|rooms|homestay|inn|porotta|parotta|alfaham|tandoori|curry|soup|salad|fries|sandwich|pasta|sushi|ramen|momo|chaat|paneer|dal|roti|naan|cake|pastry|milkshake|smoothie|breakfast|supper|cuisine)\b/i;

const FOLLOW_UP =
  /\b(closer|nearest|cheaper|parking|outdoor|seating|rating|review|reviews|distance|walking|taste|tasty|flavour|flavor|portion|service|clean|hygiene|crowd|crowded|quiet|takeaway|delivery|dine)\b/i;

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
  const allowed = await topicAllowed(message, mode);
  if (!allowed) throw new HttpError(400, REJECT);
}
