/**
 * Microstock Seasonal Calendar + Universal World Categories
 * & Multi-Subject Anti-Mainstream Google Flow Prompt Generator
 *
 * Designed to prevent Adobe Stock "Similar Content / Spam" & "Technical Quality" rejections
 * by generating 3 distinct sub-subjects + unconventional commercial angles per theme.
 */

export const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * Unconventional commercial angles & lighting styles that Adobe Stock curators love
 * (Avoids generic centered AI clichés that trigger "Similar Content" rejection)
 */
const COMMERCIAL_ANGLES = [
  {
    tag: 'Foto • Sudut Unik & Copy Space',
    template: (subject, context) =>
      `High-end commercial editorial photography of ${subject}, ${context}, shot from an unconventional off-center angle with dramatic natural window shadow play, tactile surface textures, 45% clean negative copy space on one side for advertising typography, crisp optical focus, natural color grading, no text, no brand logos, no watermark.`
  },
  {
    tag: '3D Podium • Komersial Iklan',
    template: (subject, context) =>
      `Minimalist luxury 3D architectural stage featuring ${subject}, ${context}, set on a matte travertine and brushed metal geometric podium, soft studio rim lighting, subtle depth of field, generous clean background copy space for product placement, contemporary commercial design, no text, no watermark.`
  },
  {
    tag: 'Flat Vector • Siap Cutout SVG',
    template: (subject, context) =>
      `Clean modern flat vector illustration set of ${subject}, ${context}, distinctive geometric minimalist style with harmonious bold solid color palette, crisp bezier contours, completely isolated on pure white background #FFFFFF, zero gradients, zero photo textures, ready for SVG vector stock, no text.`
  },
  {
    tag: 'Macro Detail • Tekstur Tajam',
    template: (subject, context) =>
      `Extreme high-detail commercial close-up of ${subject}, ${context}, showcasing authentic micro-textures and warm golden hour rim light, clean uncluttered background with smooth bokeh copy space, commercial stock photography, no text, no logos.`
  },
  {
    tag: 'Aerial Flat-Lay • Komposisi Modern',
    template: (subject, context) =>
      `Top-down knolling flat lay photography of ${subject}, ${context}, arranged with geometric precision on a clean textured matte surface, crisp morning sunlight shadows, wide open center copy space for banner design, commercial stock quality, no text.`
  }
];

/**
 * 12-Month Seasonal Calendar (with 6-8 distinct sub-subjects per event so users get varied objects)
 */
export const MICROSTOCK_NICHE_CALENDAR = [
  {
    id: 'new-year-vision',
    month: 0, // Januari
    group: 'seasonal',
    title: 'Tahun Baru, Resolusi, Finansial & Perencanaan',
    category: 'Business',
    buyerTarget: 'Fintech, perbankan, aplikasi produktivitas, kampanye awal tahun',
    keywords: ['new year', 'goal', 'planning', 'strategy', 'finance', 'growth', 'minimalist', 'vision', 'success', 'calendar'],
    subSubjects: [
      { subject: 'wooden desk calendar flipped to day one beside a brass compass and fountain pen', context: 'warm morning sunlight across a minimalist oak desk' },
      { subject: 'ascending stepped marble blocks with a glowing glass sphere at the summit', context: 'clean pastel studio symbolizing financial milestone and growth' },
      { subject: 'glass jar filled with sprouting gold coins and fresh green botanical leaves', context: 'clean nordic interior with soft daylight' },
      { subject: 'minimalist runner tying shoes on a misty mountain road at sunrise', context: 'new journey and personal resolution concept' },
      { subject: 'open blank linen journal with habit tracker grid and matcha latte', context: 'clean contemporary workspace flat lay' },
      { subject: 'origami paper boats in white and satu bold emerald boat leading forward', context: 'leadership and new year innovation concept' }
    ]
  },
  {
    id: 'lunar-valentine',
    month: 1, // Februari
    group: 'seasonal',
    title: 'Imlek (Lunar New Year), Valentine & Apresiasi',
    category: 'Culture and Religion',
    buyerTarget: 'E-commerce, perhotelan, promosi F&B, kartu ucapan modern',
    keywords: ['lunar new year', 'valentine', 'love', 'gift', 'lantern', 'red', 'gold', 'celebration', 'oriental', 'romance'],
    subSubjects: [
      { subject: 'modern minimalist red silk envelope (angpao) with delicate gold ginkgo leaf and ceramic teacup', context: 'contemporary Asian luxury aesthetic' },
      { subject: 'unconventional Valentine concept of two ceramic coffee mugs with interlocking warm steam trails', context: 'cozy minimalist morning table' },
      { subject: 'crimson paper lanterns and blooming white plum blossom branch over a matte stone podium', context: 'festive oriental studio lighting' },
      { subject: 'eco-friendly linen-wrapped gift box tied with dried lavender and wax seal', context: 'modern understated romantic aesthetic' },
      { subject: 'traditional wooden dim sum steamer basket with glowing warm steam in sunlit courtyard', context: 'authentic festive culinary atmosphere' },
      { subject: 'two minimalist paper airplanes flying together across a pastel coral sky', context: 'long distance love and connection concept' }
    ]
  },
  {
    id: 'ramadan-eid',
    month: 2, // Maret
    group: 'seasonal',
    title: 'Ramadan, Idul Fitri & Silaturahmi Modern',
    category: 'Culture and Religion',
    buyerTarget: 'Brand FMCG, perbankan syariah, fashion muslim, e-commerce Asia & Timur Tengah',
    keywords: ['ramadan', 'eid al fitr', 'islamic', 'lantern', 'crescent', 'dates', 'iftar', 'mosque', 'hospitality', 'festive'],
    subSubjects: [
      { subject: 'contemporary brass Moroccan fanoos lantern casting intricate geometric shadow patterns on a warm sand-colored wall', context: 'minimalist architectural desert sunset' },
      { subject: 'artisanal ceramic platter of Medjool dates, figs, and pistachios beside a hammered copper pitcher', context: 'authentic modern iftar table setting' },
      { subject: 'minimalist sage green and gold islamic arch podium with floating crescent moon', context: 'luxury commercial Ramadan display stage' },
      { subject: 'woven ketupat leaves arranged artistically on a white marble table with tropical pandan leaves', context: 'clean Southeast Asian Eid celebration concept' },
      { subject: 'open minimalist Quran stand (rehal) made of light birch wood by a sunlit arched window', context: 'peaceful spiritual morning ambiance' },
      { subject: 'collection of luxury glass oud perfume bottles on a desert sandstone pedestal', context: 'festive Eid gifting and self-care concept' }
    ]
  },
  {
    id: 'earth-day-esg',
    month: 3, // April
    group: 'seasonal',
    title: 'Hari Bumi, Energi Hijau, Daur Ulang & ESG',
    category: 'The Environment',
    buyerTarget: 'Laporan keberlanjutan korporat, perusahaan energi terbarukan, kemasan ramah lingkungan',
    keywords: ['sustainability', 'earth day', 'green energy', 'solar', 'wind turbine', 'recycle', 'ecology', 'esg', 'nature', 'net zero'],
    subSubjects: [
      { subject: 'translucent glass sphere containing a miniature lush moss forest resting on a solar panel surface', context: 'clean tech and nature harmony' },
      { subject: 'biodegradable molded pulp packaging and refillable amber glass bottles with green leaves', context: 'zero waste sustainable cosmetic branding' },
      { subject: 'offshore white wind turbines rising from calm turquoise ocean under morning mist', context: 'clean renewable energy infrastructure' },
      { subject: 'electric vehicle charging cable plugged into a futuristic moss-covered green wall station', context: 'sustainable urban mobility concept' },
      { subject: 'hands planting a young oak sapling into rich dark soil with morning dew drops', context: 'reforestation and carbon offset concept' }
    ]
  },
  {
    id: 'mental-health-wellness',
    month: 4, // Mei
    group: 'seasonal',
    title: 'Kesehatan Mental, Mindfulness & Keseimbangan Hidup',
    category: 'States of Mind',
    buyerTarget: 'Aplikasi kesehatan, HR korporat, klinik, artikel psikologi & lifestyle',
    keywords: ['mental health', 'mindfulness', 'wellness', 'calm', 'balance', 'meditation', 'self care', 'peace', 'harmony', 'relaxation'],
    subSubjects: [
      { subject: 'precariously balanced sculptural stack of natural river pebbles and terracotta shapes', context: 'soft pastel morning light symbolizing emotional balance' },
      { subject: 'minimalist wooden aroma diffuser releasing gentle mist beside a singing bowl and eucalyptus', context: 'serene spa and digital detox corner' },
      { subject: 'person sitting on a wooden pier overlooking a mirror-still alpine lake at dawn', context: 'solitude, clarity, and stress relief' },
      { subject: 'tangled chaotic dark thread transforming into a neat glowing emerald line', context: 'therapy, problem solving, and mental clarity concept' }
    ]
  },
  {
    id: 'summer-travel-vacation',
    month: 5, // Juni
    group: 'seasonal',
    title: 'Liburan Musim Panas, Wisata Pantai & Kuliner Segar',
    category: 'Travel',
    buyerTarget: 'Maskapai, hotel, travel agent, produk skincare UV & minuman segar',
    keywords: ['summer', 'travel', 'vacation', 'tropical', 'beach', 'ocean', 'holiday', 'sunscreen', 'island', 'refreshing'],
    subSubjects: [
      { subject: 'vintage yellow hard-shell suitcase and straw hat on a wooden boat deck facing turquoise coral lagoon', context: 'wanderlust summer island getaway' },
      { subject: 'unlabeled frosted sunscreen bottle on wet travertine stone splashed with crystal water droplets and tropical hibiscus', context: 'summer skincare commercial photography' },
      { subject: 'artisan citrus iced mocktail with rosemary sprig and crushed ice casting caustic prism reflections on white linen', context: 'refreshing summer beverage promo' },
      { subject: 'aerial drone view of a single wooden kayak floating over crystal clear turquoise shallow reef', context: 'minimalist tropical adventure with wide ocean copy space' }
    ]
  },
  {
    id: 'ai-cybersecurity-tech',
    month: 6, // Juli
    group: 'seasonal',
    title: 'Teknologi AI, Keamanan Siber & Transformasi Digital',
    category: 'Technology',
    buyerTarget: 'Startup SaaS, perbankan digital, portal berita teknologi, konsultan IT',
    keywords: ['artificial intelligence', 'cybersecurity', 'cloud', 'data', 'microchip', 'network', 'digital', 'security', 'innovation', 'future'],
    subSubjects: [
      { subject: 'glowing translucent glass padlock shield hovering over a dark brushed aluminum processor wafer', context: 'enterprise cybersecurity and encryption concept' },
      { subject: 'minimalist robotic hand and human hand touching a floating holographic data cube', context: 'ethical AI collaboration in clean studio' },
      { subject: 'optical fiber light trails flowing into a sleek glass server rack in a clean white data center', context: 'high-speed cloud computing infrastructure' },
      { subject: 'biometric fingerprint wave made of glowing emerald particles over a smart card', context: 'fintech authentication and privacy' }
    ]
  },
  {
    id: 'back-to-school-education',
    month: 7, // Agustus
    group: 'seasonal',
    title: 'Back to School, Sains, Edukasi & Kemerdekaan',
    category: 'Science',
    buyerTarget: 'Platform edtech, sekolah/universitas, brand alat tulis & laptop',
    keywords: ['education', 'school', 'learning', 'study', 'science', 'student', 'stationery', 'knowledge', 'creative', 'campus'],
    subSubjects: [
      { subject: 'modern geometric stationery set, wireless headphones, and digital stylus arranged on a two-tone pastel desk', context: 'contemporary hybrid e-learning concept' },
      { subject: 'glowing glass laboratory flask with botanical extract and molecular model on a clean white lab bench', context: 'modern biotechnology and STEM education' },
      { subject: 'paper rocket launching from an open hardcover book with colorful paper clouds', context: 'creative imagination and literacy concept' },
      { subject: 'minimalist red and white architectural ribbons flowing in bright blue sky over modern city skyline', context: 'Indonesian independence and national progress concept' }
    ]
  },
  {
    id: 'autumn-cozy-harvest',
    month: 8, // September
    group: 'seasonal',
    title: 'Musim Gugur, Interior Hangat & UMKM Kreatif',
    category: 'Lifestyle',
    buyerTarget: 'Coffee shop, brand furniture/interior, fashion rajut, blog bisnis',
    keywords: ['autumn', 'cozy', 'coffee', 'interior', 'warm', 'fall', 'craft', 'artisan', 'home', 'seasonal'],
    subSubjects: [
      { subject: 'handcrafted ceramic pour-over coffee dripper with rising steam on a walnut table beside golden ginkgo leaves', context: 'artisan slow living autumn morning' },
      { subject: 'minimalist Japandi living room corner with bouclé armchair, dried pampas grass, and warm afternoon sunbeams', context: 'cozy interior design catalog' },
      { subject: 'potter hands shaping wet terracotta clay on a spinning wheel in a sunlit studio', context: 'authentic small business craftsmanship' }
    ]
  },
  {
    id: 'halloween-spooky-autumn',
    month: 9, // Oktober
    group: 'seasonal',
    title: 'Halloween Estetik, Festival Musim Gugur & Pink October',
    category: 'Hobbies and Leisure',
    buyerTarget: 'Promosi diskon Oktober, acara hiburan, kampanye kesehatan wanita',
    keywords: ['halloween', 'pumpkin', 'october', 'autumn', 'candle', 'lantern', 'festive', 'pink ribbon', 'mystery', 'decor'],
    subSubjects: [
      { subject: 'matte white and metallic gold painted minimalist pumpkins on a dark slate pedestal with Dramatic rim lighting', context: 'luxury modern Halloween retail display (non-cliché)' },
      { subject: 'floating vintage brass keys, dried black roses, and flickering beeswax candles in a misty gothic arch', context: 'mysterious dark academia autumn aesthetic' },
      { subject: 'soft satin pink ribbon pinned on a white tweed blazer beside blooming pink camellia flowers', context: 'breast cancer awareness and women healthcare campaign' },
      { subject: 'cute minimalist papercraft bats, crescent moon, and glowing lantern house in layered shadowbox style', context: 'family-friendly Halloween illustration' }
    ]
  },
  {
    id: 'black-friday-shopping',
    month: 10, // November
    group: 'seasonal',
    title: 'Black Friday, Cyber Monday & Harbolnas E-Commerce',
    category: 'Business',
    buyerTarget: 'Marketplace, toko online, fintech paylater, agensi iklan digital',
    keywords: ['black friday', 'cyber monday', 'shopping', 'sale', 'ecommerce', 'discount', 'gift box', 'retail', 'delivery', 'promotion'],
    subSubjects: [
      { subject: 'matte black and emerald green shopping bags levitating above a glowing neon podium', context: 'sleek Cyber Monday mega sale banner' },
      { subject: 'minimalist miniature shopping cart carrying a single glowing golden gift box on a clean studio ramp', context: 'premium e-commerce checkout concept' },
      { subject: 'stack of neat cardboard delivery parcels tied with satin ribbon beside a smartphone with blank screen', context: 'fast online shopping and logistics promo' }
    ]
  },
  {
    id: 'christmas-winter-holiday',
    month: 11, // Desember
    group: 'seasonal',
    title: 'Natal (Christmas), Liburan Musim Dingin & Tahun Baru',
    category: 'Culture and Religion',
    buyerTarget: 'Brand global, kartu ucapan perusahaan, retail hadiah, perhotelan & travel',
    keywords: ['christmas', 'holiday', 'winter', 'festive', 'gift', 'ornament', 'pine', 'santa hat', 'golden bauble', 'celebration'],
    subSubjects: [
      { subject: 'velvet Santa hat resting on a vintage leather travel suitcase beside tropical sunglasses on white sand', context: 'unconventional Christmas holiday travel getaway concept' },
      { subject: 'macro cluster of matte brushed-gold and emerald glass baubles resting on frosted noble fir pine needles', context: 'luxury Christmas ornament texture with warm fairy light bokeh' },
      { subject: 'eco-friendly kraft paper Christmas gift boxes tied with twine, dried orange slices, star anise, and cinnamon sticks', context: 'Nordic sustainable holiday gifting flat lay' },
      { subject: 'minimalist geometric origami pine trees in white and gold arranged on a snow-dusted marble podium', context: 'modern architectural Christmas product display stage' },
      { subject: 'red knitted mittens holding a steaming ceramic mug of hot cocoa with marshmallows by a frosted window', context: 'cozy winter cabin holiday warmth' },
      { subject: 'traditional wooden nutcracker figure and glowing brass candle holder casting long dramatic shadows', context: 'classic nostalgic Christmas eve atmosphere' },
      { subject: 'sleek metallic sleigh bell and golden ribbon on a deep burgundy velvet surface', context: 'minimalist luxury holiday greeting card background' }
    ]
  },

  // ============================================================================
  // UNIVERSAL WORLD CATEGORIES (Olahraga, Mobil/Motor, Alam/Gunung/Laut, Kantor, dll.)
  // ============================================================================
  {
    id: 'world-nature-mountain-sea',
    month: null,
    group: 'universal',
    title: 'Alam, Gunung, Laut & Pemandangan (Nature & Landscapes)',
    category: 'Landscapes',
    buyerTarget: 'Travel brand, dokumenter lingkungan, dekorasi dinding, background website',
    keywords: ['nature', 'landscape', 'mountain', 'ocean', 'forest', 'sunrise', 'scenic', 'wilderness', 'water', 'aerial'],
    subSubjects: [
      { subject: 'jagged volcanic mountain peaks piercing through a sea of golden morning clouds at sunrise', context: 'majestic high-altitude alpine wilderness' },
      { subject: 'crystal clear turquoise ocean waves gently meeting black volcanic sand beach from top-down aerial angle', context: 'striking natural contrast with copy space' },
      { subject: 'sunbeams filtering through ancient misty pine forest onto a mossy winding footpath', context: 'serene woodland atmosphere' },
      { subject: 'underwater split-level view of vibrant coral reef below and calm sunny sky with a small wooden boat above', context: 'marine biodiversity and tropical ocean' },
      { subject: 'minimalist desert sand dunes with sharp wind-carved ridges under warm terracotta sunset light', context: 'abstract natural geometry' },
      { subject: 'hidden emerald waterfall cascading into a basalt rock canyon surrounded by tropical ferns', context: 'untouched rainforest sanctuary' }
    ]
  },
  {
    id: 'world-automotive-cars-bikes',
    month: null,
    group: 'universal',
    title: 'Otomotif: Mobil, Motor & Transportasi Modern',
    category: 'Transport',
    buyerTarget: 'Otomotif, asuransi kendaraan, logistik, oli/suku cadang, aplikasi transportasi',
    keywords: ['automotive', 'car', 'motorcycle', 'electric vehicle', 'transport', 'highway', 'driving', 'speed', 'adventure', 'mobility'],
    subSubjects: [
      { subject: 'unbranded sleek aerodynamic electric concept car driving on a coastal cliff highway at blue hour', context: 'motion blur road and clean futuristic lighting (no brand logos)' },
      { subject: 'custom cafe-racer adventure motorcycle parked on a misty mountain pass at sunrise with rider helmet on tank', context: 'freedom and solo road trip concept (no logos)' },
      { subject: 'close-up of a modern minimalist EV dashboard and panoramic windshield overlooking a smart highway', context: 'autonomous driving and connected mobility' },
      { subject: 'heavy electric cargo truck driving across a modern suspension bridge at dawn', context: 'global supply chain and green logistics' },
      { subject: 'vintage classic convertible roadster cruising along a palm-lined desert road in warm retro sunlight', context: 'timeless summer road trip aesthetic (unbranded)' }
    ]
  },
  {
    id: 'world-sports-fitness-active',
    month: null,
    group: 'universal',
    title: 'Olahraga, Fitness, Lari & Aktivitas Outdoor',
    category: 'Sports',
    buyerTarget: 'Brand apparel olahraga, gym, suplemen kesehatan, event marathon, berita olahraga',
    keywords: ['sport', 'fitness', 'running', 'workout', 'athlete', 'training', 'active', 'energy', 'padel', 'cycling'],
    subSubjects: [
      { subject: 'low-angle close-up of running shoes splashing through a thin rain puddle on an urban asphalt track at sunrise', context: 'dynamic marathon training energy (no brand logos)' },
      { subject: 'minimalist outdoor blue padel and tennis court with long geometric morning shadows, racket and yellow ball', context: 'trendy contemporary racket sport aesthetic' },
      { subject: 'road cyclist climbing a steep misty mountain switchback road against golden sunrise backlight', context: 'endurance, grit, and outdoor sport' },
      { subject: 'kettlebell, wooden gymnastic rings, and chalk dust illuminated by dramatic sunbeams in an industrial gym', context: 'strength training and cross-fitness concept' },
      { subject: 'swimmer diving into crystal clear blue Olympic pool lane captured from underwater with air bubbles', context: 'refreshing aquatic sport action' }
    ]
  },
  {
    id: 'world-office-business-work',
    month: null,
    group: 'universal',
    title: 'Kantor Modern, Bisnis, Startup & Keuangan',
    category: 'Business',
    buyerTarget: 'Konsultan bisnis, bank, software B2B, HRD, presentasi perusahaan',
    keywords: ['office', 'business', 'workspace', 'meeting', 'startup', 'coworking', 'architecture', 'finance', 'productivity', 'corporate'],
    subSubjects: [
      { subject: 'sunlit minimalist biophilic office boardroom with glass walls, indoor olive trees, and light oak table', context: 'modern sustainable corporate workplace' },
      { subject: 'ergonomic standing desk setup with ultrawide blank monitor, mechanical keyboard, and warm desk lamp', context: 'productive remote work home office' },
      { subject: 'overhead view of diverse hands assembling geometric wooden building blocks on a blueprint table', context: 'strategic teamwork and business problem solving' },
      { subject: 'modern glass skyscraper facade reflecting dramatic clouds and golden sunset light from low angle', context: 'financial district and corporate growth' },
      { subject: 'minimalist coworking cafe booth with laptop, espresso cup, and acoustic wooden slat wall', context: 'digital nomad and flexible work lifestyle' }
    ]
  },
  {
    id: 'world-food-drink-culinary',
    month: null,
    group: 'universal',
    title: 'Kuliner, Makanan Sehat, Kopi & Minuman',
    category: 'Food',
    buyerTarget: 'Restoran, aplikasi pesan-antar makanan, kemasan FMCG, blog nutrisi',
    keywords: ['food', 'culinary', 'coffee', 'healthy food', 'organic', 'fresh', 'beverage', 'breakfast', 'ingredients', 'gourmet'],
    subSubjects: [
      { subject: 'artisan sourdough bread loaf with crispy crust, olive oil cruet, and sea salt flakes on dark stone', context: 'rustic gourmet bakery photography' },
      { subject: 'vibrant Mediterranean Buddha bowl with avocado, chickpeas, salmon, and microgreens on linen table', context: 'clean nutrition and healthy eating' },
      { subject: 'iced matcha latte swirling with oat milk in a ribbed glass on a sunlit terrazzo counter', context: 'trendy cafe beverage advertising' },
      { subject: 'freshly harvested organic vegetables with water droplets in a woven basket at a sunny farm', context: 'farm-to-table agriculture and freshness' }
    ]
  },
  {
    id: 'world-architecture-interior',
    month: null,
    group: 'universal',
    title: 'Arsitektur, Interior Rumah, Properti & Podium 3D',
    category: 'Buildings and Architecture',
    buyerTarget: 'Developer properti, desainer interior, brand cat & bahan bangunan, iklan produk',
    keywords: ['architecture', 'interior', 'minimalist', 'home', 'living room', 'podium', 'modern house', 'real estate', 'design', 'luxury'],
    subSubjects: [
      { subject: 'minimalist concrete and warm cedar wood villa with infinity pool overlooking tropical valley at dusk', context: 'luxury architectural real estate' },
      { subject: 'sunlit Wabi-Sabi living room with limewash walls, low linen sofa, and handcrafted ceramic vase', context: 'calm contemporary interior design' },
      { subject: 'travertine stone arch and cylindrical pedestal over shallow reflective water with palm leaf shadow', context: '3D cosmetic and luxury product mockup stage' },
      { subject: 'spiral white sculptural staircase viewed from below with soft natural skylight', context: 'minimalist architectural geometry' }
    ]
  },
  {
    id: 'world-health-medical-skincare',
    month: null,
    group: 'universal',
    title: 'Kesehatan, Medis, Laboratorium & Skincare',
    category: 'Science',
    buyerTarget: 'Rumah sakit, farmasi, brand skincare/kosmetik, asuransi kesehatan',
    keywords: ['healthcare', 'medical', 'skincare', 'laboratory', 'science', 'cosmetic', 'serum', 'wellness', 'biotech', 'clean'],
    subSubjects: [
      { subject: 'unlabeled frosted dropper bottle of golden hyaluronic serum surrounded by water ripples and white camellia flower', context: 'clinical botanical skincare advertising' },
      { subject: 'modern bright pharmaceutical laboratory with glass pipettes, petri dish, and green plant extract', context: 'biotechnology and natural medicine research' },
      { subject: 'minimalist white stethoscope and digital health tablet on a clean pastel teal medical desk', context: 'telemedicine and modern healthcare service' },
      { subject: 'macro drop of pure vitamin oil falling from a glass pipette with crisp studio backlight', context: 'cosmetic science and purity concept' }
    ]
  },
  {
    id: 'world-animals-pets-wildlife',
    month: null,
    group: 'universal',
    title: 'Hewan Peliharaan, Kucing, Anjing & Satwa Liar',
    category: 'Animals',
    buyerTarget: 'Produk pet shop, makanan hewan, klinik dokter hewan, edukasi konservasi',
    keywords: ['animal', 'pet', 'cat', 'dog', 'wildlife', 'bird', 'nature', 'cute', 'companion', 'portrait'],
    subSubjects: [
      { subject: 'fluffy ginger cat sitting curious behind a minimalist pastel yellow studio wall peeking sideways', context: 'clean commercial pet food advertising with wide copy space' },
      { subject: 'happy golden retriever dog wearing a bandana sitting in a sunlit meadow with copy space sky', context: 'pet care and veterinary wellness' },
      { subject: 'two vibrant scarlet macaw parrots perched on a mossy rainforest branch in morning mist', context: 'exotic tropical wildlife conservation' },
      { subject: 'graceful koi fish swimming in crystal clear water over white pebbles viewed from top-down angle', context: 'zen harmony and prosperity symbol' }
    ]
  }
];

/**
 * Builds 3 distinct, non-cliché prompts for a niche by picking 3 different sub-subjects
 * and pairing them with distinct commercial angles (Photo, 3D Podium, Flat Vector, Macro, Flat-Lay)
 */
export function buildVariedPromptsForNiche(niche, seedOffset = 0) {
  const pool = niche.subSubjects || [];
  if (pool.length === 0) {
    return niche.prompts || [];
  }

  const pickedPrompts = [];
  const styleOrder = [0, 1, 2, 3, 4]; // Photo, 3D Podium, Flat Vector, Macro, Flat-Lay

  for (let i = 0; i < 3; i++) {
    const subIdx = (seedOffset + i) % pool.length;
    const angleIdx = styleOrder[(seedOffset + i) % styleOrder.length];
    const sub = pool[subIdx];
    const angle = COMMERCIAL_ANGLES[angleIdx];

    pickedPrompts.push({
      style: `Variasi #${i + 1} • ${angle.tag}`,
      subTitle: sub.subject,
      prompt: angle.template(sub.subject, sub.context)
    });
  }

  return pickedPrompts;
}

/**
 * Computes categorized niches relative to a base month (0-11)
 * - 'ahead_3_6': 3 to 6 months ahead (Golden Window Persiapan Stok)
 * - 'now': Current month + next 1-2 months (Sedang Ramai)
 * - 'universal': All universal world categories (Olahraga, Otomotif, Alam, Kantor, Kuliner, dll.)
 * - 'all': Everything
 */
export function getNichesByHorizon(horizon = 'ahead_3_6', baseMonth = new Date().getMonth(), seedMap = {}) {
  if (horizon === 'universal' || horizon === 'evergreen') {
    return MICROSTOCK_NICHE_CALENDAR.filter(n => n.group === 'universal').map(n => {
      const seed = seedMap[n.id] || 0;
      return {
        ...n,
        timingLabel: `Kategori: ${n.category}`,
        timingType: 'evergreen',
        prompts: buildVariedPromptsForNiche(n, seed)
      };
    });
  }

  const seasonal = MICROSTOCK_NICHE_CALENDAR.filter(n => n.month !== null).map(n => {
    const diff = (n.month - baseMonth + 12) % 12;
    let timingLabel = `Bulan ${MONTH_NAMES_ID[n.month]}`;
    let timingType = 'other';

    if (diff === 0) {
      timingLabel = `Bulan Ini • ${MONTH_NAMES_ID[n.month]}`;
      timingType = 'now';
    } else if (diff === 1 || diff === 2) {
      timingLabel = `${MONTH_NAMES_ID[n.month]} (+${diff} Bulan)`;
      timingType = 'soon';
    } else if (diff >= 3 && diff <= 6) {
      timingLabel = `${MONTH_NAMES_ID[n.month]} (+${diff} Bulan)`;
      timingType = 'ahead_3_6';
    }

    const seed = seedMap[n.id] || 0;
    return {
      ...n,
      monthDiff: diff,
      timingLabel,
      timingType,
      prompts: buildVariedPromptsForNiche(n, seed)
    };
  });

  seasonal.sort((a, b) => a.monthDiff - b.monthDiff);

  if (horizon === 'now') {
    return seasonal.filter(n => n.monthDiff <= 2);
  }
  if (horizon === 'ahead_3_6') {
    return seasonal.filter(n => n.monthDiff >= 3 && n.monthDiff <= 6);
  }

  return [
    ...seasonal,
    ...MICROSTOCK_NICHE_CALENDAR.filter(n => n.group === 'universal').map(n => {
      const seed = seedMap[n.id] || 0;
      return {
        ...n,
        timingLabel: `Universal • ${n.category}`,
        timingType: 'evergreen',
        prompts: buildVariedPromptsForNiche(n, seed)
      };
    })
  ];
}
