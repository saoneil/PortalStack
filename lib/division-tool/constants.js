const EVENT_COLUMNS = [
  'individual_patterns',
  'individual_sparring',
  'individual_special_technique',
  'individual_power_test',
  'team_patterns',
  'team_sparring',
  'team_special_technique',
  'team_power_test',
  'pre_arranged_sparring'
];

const LIST_DRAW_TYPE_EVENT_KEYS = new Set([
  'individual_special_technique',
  'individual_power_test',
  'team_special_technique',
  'team_power_test'
]);

const RANK_ORDER = [
  '10th gup', '9th gup', '8th gup', '7th gup', '6th gup',
  '5th gup', '4th gup', '3rd gup', '2nd gup', '1st gup',
  '1st dan', '2nd dan', '3rd dan', '4th dan', '5th dan', '6th dan'
];

const EVENT_DISPLAY_NAMES = {
  individual_patterns: 'INDIVIDUAL PATTERNS',
  individual_sparring: 'INDIVIDUAL SPARRING',
  individual_special_technique: 'INDIVIDUAL SPECIAL TECHNIQUE',
  individual_power_test: 'INDIVIDUAL POWER TEST',
  team_patterns: 'TEAM PATTERNS',
  team_sparring: 'TEAM SPARRING',
  team_special_technique: 'TEAM SPECIAL TECHNIQUE',
  team_power_test: 'TEAM POWER TEST',
  pre_arranged_sparring: 'PRE ARRANGED SPARRING'
};

const PATTERN_WEIGHT_CLASSES = ['light', 'middle', 'heavy'];
const PATTERN_HEIGHT_CLASSES = ['short', 'medium', 'tall'];
const LMH_TERTILE_SPLIT_MIN_ATHLETES = 6;

const DEFAULT_DRAW_RING_NUMBER = 'Ring 1';
const GROUPINGS_FORMAT_VERSION = 1;
const DRAWS_FORMAT_VERSION = 1;
const DIVISIONS_DB_FORMAT_VERSION = 1;
const ALL_DRAWS_PDF_FILENAME = 'all_draws.pdf';
const ALL_RESULTS_PDF_FILENAME = 'all_results.pdf';

const DRAW_TYPE_OPTIONS = ['Single Elimination', 'Round Robin', 'Premier League', 'List'];

module.exports = {
  EVENT_COLUMNS,
  LIST_DRAW_TYPE_EVENT_KEYS,
  RANK_ORDER,
  EVENT_DISPLAY_NAMES,
  PATTERN_WEIGHT_CLASSES,
  PATTERN_HEIGHT_CLASSES,
  LMH_TERTILE_SPLIT_MIN_ATHLETES,
  DEFAULT_DRAW_RING_NUMBER,
  GROUPINGS_FORMAT_VERSION,
  DRAWS_FORMAT_VERSION,
  DIVISIONS_DB_FORMAT_VERSION,
  ALL_DRAWS_PDF_FILENAME,
  ALL_RESULTS_PDF_FILENAME,
  DRAW_TYPE_OPTIONS
};
