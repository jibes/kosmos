/**
 * Each kind of place: the OSM values (OpenMapTiles `subclass`) that belong to it, and words
 * that name it in the UI languages, without case or accents. iD's preset names and terms for
 * those values (`placeWords.ts`, `npm run words`) add to the words. A value may belong to a
 * group ("Groceries") and to its own kind ("Bakeries").
 *
 * No imports: `scripts/place-words.mjs` reads this file as it is.
 */
export const TABLE = {
  restaurant: {
    tags: ['restaurant', 'food_court'],
    words: ['restaurant', 'restaurants', 'essen', 'food', 'gaststatte', 'lokal', 'dinner'],
  },
  fast_food: {
    tags: ['fast_food'],
    words: ['imbiss', 'imbisse', 'fast food', 'takeaway', 'doner', 'kebab', 'burger', 'essen'],
  },
  cafe: {
    tags: ['cafe'],
    words: ['cafe', 'cafes', 'coffee', 'kaffee'],
  },
  ice_cream: {
    tags: ['ice_cream'],
    words: ['eis', 'eiscafe', 'eisdiele', 'gelato', 'ice cream'],
  },
  bar: {
    tags: ['bar', 'pub', 'biergarten'],
    words: ['bar', 'bars', 'kneipe', 'pub', 'pubs', 'biergarten'],
  },
  nightclub: {
    tags: ['nightclub'],
    words: ['club', 'clubs', 'disco', 'diskothek', 'nightclub'],
  },
  groceries: {
    tags: [
      'supermarket',
      'convenience',
      'greengrocer',
      'general',
      'deli',
      'delicatessen',
      'frozen_food',
      'farm',
      'bakery',
      'butcher',
    ],
    words: [
      'lebensmittel',
      'supermarkt',
      'supermarket',
      'groceries',
      'grocery',
      'einkaufen',
      'discounter',
    ],
  },
  bakery: {
    tags: ['bakery'],
    words: ['backer', 'backerei', 'bakery', 'brot', 'brotchen', 'bread'],
  },
  butcher: {
    tags: ['butcher'],
    words: ['metzger', 'metzgerei', 'fleischer', 'fleischerei', 'butcher'],
  },
  drinks: {
    tags: ['alcohol', 'beverages', 'wine'],
    words: ['getranke', 'getrankemarkt', 'wein', 'weinhandlung', 'off licence', 'liquor store'],
  },
  kiosk: {
    tags: ['kiosk', 'newsagent', 'tobacco'],
    words: ['kiosk', 'spati', 'spatkauf', 'trinkhalle', 'zeitschriften', 'tabak', 'newsagent'],
  },
  market: {
    tags: ['marketplace'],
    words: ['markt', 'wochenmarkt', 'marktplatz', 'market', 'farmers market'],
  },
  pharmacy: {
    tags: ['pharmacy'],
    words: ['apotheke', 'apotheken', 'pharmacy', 'pharmacies'],
  },
  chemist: {
    tags: ['chemist', 'cosmetics', 'perfumery', 'perfume'],
    words: ['drogerie', 'drogeriemarkt', 'chemist', 'drugstore', 'parfumerie'],
  },
  doctor: {
    tags: ['doctors', 'clinic'],
    words: ['arzt', 'arzte', 'arztpraxis', 'praxis', 'hausarzt', 'doctor', 'doctors', 'gp'],
  },
  dentist: {
    tags: ['dentist'],
    words: ['zahnarzt', 'zahnarzte', 'zahnarztin', 'dentist'],
  },
  hospital: {
    tags: ['hospital'],
    words: ['krankenhaus', 'klinikum', 'klinik', 'hospital', 'notaufnahme', 'emergency'],
  },
  optician: {
    tags: ['optician', 'hearing_aids'],
    words: ['optiker', 'brille', 'brillen', 'optician', 'glasses', 'horgerate', 'hearing aids'],
  },
  vet: {
    tags: ['veterinary'],
    words: ['tierarzt', 'tierarzte', 'tierklinik', 'vet', 'vets', 'veterinary'],
  },
  bank: {
    tags: ['bank'],
    words: ['bank', 'banken', 'banks', 'sparkasse', 'volksbank'],
  },
  atm: {
    tags: ['atm'],
    words: ['geldautomat', 'bankautomat', 'atm', 'cash', 'cashpoint', 'geld'],
  },
  post: {
    tags: ['post_office', 'parcel_locker'],
    words: [
      'post',
      'postamt',
      'post office',
      'postfiliale',
      'packstation',
      'paketstation',
      'paket',
    ],
  },
  post_box: {
    tags: ['post_box'],
    words: ['briefkasten', 'postbox', 'post box', 'postbriefkasten', 'mailbox', 'letterbox'],
  },
  police: {
    tags: ['police'],
    words: ['polizei', 'police', 'wache'],
  },
  townhall: {
    tags: ['townhall'],
    words: ['rathaus', 'town hall', 'city hall', 'council'],
  },
  hairdresser: {
    tags: ['hairdresser'],
    words: ['friseur', 'frisor', 'frisur', 'hairdresser', 'barber', 'haircut'],
  },
  beauty: {
    tags: ['beauty', 'massage', 'tattoo'],
    words: ['kosmetik', 'kosmetikstudio', 'nagelstudio', 'nails', 'beauty', 'spa', 'massage'],
  },
  laundry: {
    tags: ['laundry', 'dry_cleaning'],
    words: ['waschsalon', 'wascherei', 'reinigung', 'laundry', 'launderette', 'dry cleaning'],
  },
  car: {
    tags: ['car', 'car_repair', 'car_parts'],
    words: ['autohaus', 'werkstatt', 'autowerkstatt', 'kfz', 'reifen', 'car dealer', 'garage'],
  },
  fuel: {
    tags: ['fuel'],
    words: ['tankstelle', 'tanken', 'fuel', 'gas station', 'petrol', 'petrol station', 'diesel'],
  },
  charging: {
    tags: ['charging_station'],
    words: ['ladestation', 'ladesaule', 'ladepunkt', 'e-auto', 'charging', 'charger', 'ev'],
  },
  parking: {
    tags: ['parking'],
    words: ['parkplatz', 'parkplatze', 'parken', 'parkhaus', 'parking', 'car park'],
  },
  bicycle_parking: {
    tags: ['bicycle_parking'],
    words: ['fahrradstander', 'fahrradparkplatz', 'radstander', 'bike parking', 'bicycle parking'],
  },
  bicycle: {
    tags: ['bicycle'],
    words: ['fahrrad', 'fahrradladen', 'radladen', 'fahrradwerkstatt', 'bike shop', 'bike repair'],
  },
  bicycle_rental: {
    tags: ['bicycle_rental'],
    words: ['fahrradverleih', 'leihrad', 'leihfahrrad', 'bike rental', 'bike hire', 'bike share'],
  },
  station: {
    tags: ['station', 'halt'],
    words: [
      'bahnhof',
      'bahnhofe',
      'station',
      'stations',
      'train station',
      'railway station',
      'haltepunkt',
      's-bahn',
      'sbahn',
      'u-bahn',
      'ubahn',
      'u-bahnhof',
      'metro',
      'subway',
      'underground',
      'tube',
      'zug',
      'train',
    ],
  },
  tram_stop: {
    tags: ['tram_stop'],
    words: ['tram', 'tram stop', 'strassenbahn', 'strassenbahnhaltestelle', 'haltestelle'],
  },
  bus_stop: {
    tags: ['bus_stop', 'bus_station'],
    words: [
      'bus',
      'bus stop',
      'bus station',
      'bushaltestelle',
      'bushalt',
      'busbahnhof',
      'zob',
      'haltestelle',
    ],
  },
  taxi: {
    tags: ['taxi'],
    words: ['taxi', 'taxis', 'taxistand', 'cab', 'taxi rank'],
  },
  toilets: {
    tags: ['toilets'],
    words: ['toilette', 'toiletten', 'wc', 'toilets', 'toilet', 'restroom'],
  },
  drinking_water: {
    tags: ['drinking_water'],
    words: ['trinkwasser', 'trinkbrunnen', 'wasser', 'drinking water', 'water fountain'],
  },
  recycling: {
    tags: ['recycling'],
    words: ['recycling', 'glascontainer', 'altglas', 'altkleider', 'wertstoffhof', 'container'],
  },
  clothes: {
    tags: ['clothes', 'boutique', 'bag', 'accessories', 'fabric'],
    words: ['kleidung', 'mode', 'bekleidung', 'klamotten', 'clothes', 'clothing', 'fashion'],
  },
  shoes: {
    tags: ['shoes'],
    words: ['schuhe', 'schuhgeschaft', 'schuhladen', 'shoes', 'shoe shop'],
  },
  second_hand: {
    tags: ['second_hand', 'charity'],
    words: ['second hand', 'secondhand', 'gebraucht', 'charity shop', 'thrift', 'vintage'],
  },
  electronics: {
    tags: ['electronics', 'computer', 'hifi', 'camera', 'video_games'],
    words: ['elektronik', 'elektromarkt', 'elektro', 'technik', 'electronics', 'fernseher'],
  },
  mobile_phone: {
    tags: ['mobile_phone'],
    words: ['handy', 'handyladen', 'handyshop', 'mobile phone', 'phone shop'],
  },
  diy: {
    tags: ['doityourself', 'hardware', 'paint'],
    words: ['baumarkt', 'baumarkte', 'heimwerker', 'diy', 'hardware', 'werkzeug', 'eisenwaren'],
  },
  garden_centre: {
    tags: ['garden_centre'],
    words: ['gartencenter', 'gartnerei', 'pflanzen', 'garden centre', 'plants'],
  },
  florist: {
    tags: ['florist'],
    words: ['blumen', 'blumenladen', 'florist', 'flowers'],
  },
  furniture: {
    tags: ['furniture', 'bed', 'interior_decoration', 'lamps', 'carpet'],
    words: ['mobel', 'mobelhaus', 'einrichtung', 'furniture', 'lampen'],
  },
  department_store: {
    tags: ['department_store', 'mall'],
    words: ['kaufhaus', 'warenhaus', 'einkaufszentrum', 'mall', 'shopping centre', 'shopping'],
  },
  books: {
    tags: ['books'],
    words: ['buch', 'bucher', 'buchhandlung', 'buchladen', 'books', 'bookshop', 'bookstore'],
  },
  stationery: {
    tags: ['stationery', 'copyshop'],
    words: ['schreibwaren', 'papeterie', 'copyshop', 'kopieren', 'stationery'],
  },
  toys: {
    tags: ['toys'],
    words: ['spielzeug', 'spielwaren', 'toys', 'toy shop'],
  },
  sports_shop: {
    tags: ['sports', 'outdoor'],
    words: ['sportgeschaft', 'sportladen', 'outdoor', 'sports shop'],
  },
  jewelry: {
    tags: ['jewelry', 'watches'],
    words: ['schmuck', 'juwelier', 'uhren', 'jewellery', 'jewelry', 'jeweller', 'watches'],
  },
  gift: {
    tags: ['gift', 'antiques'],
    words: ['geschenke', 'souvenirs', 'antiquitaten', 'gifts', 'souvenir', 'antiques'],
  },
  pet: {
    tags: ['pet'],
    words: ['tierbedarf', 'zoohandlung', 'zoofachhandel', 'tierfutter', 'pet shop', 'pets'],
  },
  music: {
    tags: ['music', 'musical_instrument'],
    words: ['musik', 'musikgeschaft', 'instrumente', 'music shop', 'records'],
  },
  photo: {
    tags: ['photo'],
    words: ['foto', 'fotograf', 'passbild', 'passfoto', 'photo', 'passport photo'],
  },
  travel_agency: {
    tags: ['travel_agency'],
    words: ['reiseburo', 'reisen', 'travel agent', 'travel agency'],
  },
  park: {
    tags: ['park', 'garden', 'nature_reserve'],
    words: ['park', 'parks', 'parkanlage', 'garten', 'garden', 'grunanlage', 'naturschutzgebiet'],
  },
  playground: {
    tags: ['playground'],
    words: ['spielplatz', 'spielplatze', 'playground'],
  },
  sport: {
    tags: [
      'sports_centre',
      'fitness_centre',
      'pitch',
      'stadium',
      'ice_rink',
      'golf_course',
      'miniature_golf',
    ],
    words: ['sport', 'fitness', 'gym', 'fitnessstudio', 'sportplatz', 'stadion', 'bolzplatz'],
  },
  swimming: {
    tags: ['swimming_pool', 'water_park', 'swimming_area'],
    words: ['schwimmbad', 'hallenbad', 'freibad', 'badesee', 'baden', 'swimming', 'pool', 'lido'],
  },
  museum: {
    tags: ['museum', 'gallery', 'arts_centre'],
    words: ['museum', 'museen', 'museums', 'galerie', 'gallery', 'ausstellung', 'kunst', 'art'],
  },
  theatre: {
    tags: ['theatre'],
    words: ['theater', 'theatre', 'oper', 'opera', 'schauspielhaus', 'konzerthaus'],
  },
  cinema: {
    tags: ['cinema'],
    words: ['kino', 'kinos', 'cinema', 'movies', 'film'],
  },
  sights: {
    tags: ['attraction', 'viewpoint', 'castle', 'monument', 'ruins', 'theme_park'],
    words: [
      'sehenswurdigkeit',
      'sehenswurdigkeiten',
      'sights',
      'attraction',
      'attractions',
      'aussicht',
      'viewpoint',
      'burg',
      'schloss',
      'castle',
      'denkmal',
      'monument',
      'freizeitpark',
    ],
  },
  zoo: {
    tags: ['zoo', 'aquarium'],
    words: ['zoo', 'tierpark', 'wildpark', 'aquarium', 'zoos'],
  },
  hotel: {
    tags: ['hotel', 'hostel', 'guest_house', 'motel', 'bed_and_breakfast', 'chalet', 'alpine_hut'],
    words: ['hotel', 'hotels', 'hostel', 'pension', 'unterkunft', 'ubernachtung', 'accommodation'],
  },
  camping: {
    tags: ['camp_site', 'caravan_site'],
    words: ['camping', 'campingplatz', 'zeltplatz', 'campsite', 'wohnmobil', 'stellplatz'],
  },
  library: {
    tags: ['library'],
    words: ['bibliothek', 'bucherei', 'stadtbibliothek', 'library'],
  },
  worship: {
    tags: ['place_of_worship'],
    words: ['kirche', 'church', 'dom', 'moschee', 'mosque', 'synagoge', 'synagogue', 'tempel'],
  },
  kindergarten: {
    tags: ['kindergarten'],
    words: [
      'kita',
      'kitas',
      'kindergarten',
      'kindertagesstatte',
      'krippe',
      'kinderkrippe',
      'nursery',
      'preschool',
      'daycare',
    ],
  },
  school: {
    tags: ['school'],
    words: ['schule', 'school', 'grundschule', 'gymnasium', 'realschule', 'gesamtschule'],
  },
  university: {
    tags: ['university', 'college'],
    words: ['universitat', 'university', 'uni', 'hochschule', 'fachhochschule', 'college'],
  },
  cemetery: {
    tags: ['grave_yard', 'cemetery'],
    words: ['friedhof', 'friedhofe', 'cemetery', 'graveyard'],
  },
} as const satisfies Record<string, { tags: readonly string[]; words: readonly string[] }>;
