/**
 * Vision-based image tagging using CLIP (zero-shot classification)
 * Uses @huggingface/transformers to run CLIP locally — no API keys needed.
 * Model is downloaded on first use and cached locally.
 *
 * Expansive tag library modeled after Civitai's tagging system.
 * Each group is classified independently for best CLIP accuracy.
 */

let pipeline = null;
let pipelineLoading = false;
let pipelineQueue = [];

// ─── TAG GROUPS ──────────────────────────────────────────────────────
// Each group: { labels: ['clip prompt' → 'display tag', ...], threshold, maxTags }
// CLIP prompt describes what to detect; display tag is the clean tag name.

const TAG_GROUPS = {
  // ── Subject / Scene Type ──
  subject: {
    threshold: 0.12,
    maxTags: 3,
    labels: {
      'portrait photo of a person face': 'portrait',
      'full body shot of a person standing': 'full body',
      'group of people together': 'group shot',
      'landscape scenery nature outdoors': 'landscape',
      'cityscape urban skyline buildings': 'cityscape',
      'seascape ocean beach waves': 'seascape',
      'still life arrangement of objects': 'still life',
      'abstract art shapes colors': 'abstract',
      'macro close-up photo of small details': 'macro',
      'aerial view from above birds eye': 'aerial view',
      'panoramic wide shot': 'panorama',
      'action scene with motion': 'action',
      'battle fight combat scene': 'battle',
      'romantic couple love scene': 'romance',
    }
  },

  // ── Characters / People ──
  character: {
    threshold: 0.15,
    maxTags: 3,
    labels: {
      'one woman female girl': '1girl',
      'one man male boy': '1boy',
      'multiple girls women': 'multiple girls',
      'multiple boys men': 'multiple boys',
      'couple two people together': 'couple',
      'crowd many people': 'crowd',
      'child young kid': 'child',
      'elderly old person': 'elderly',
      'monster creature beast': 'creature',
      'robot cyborg mechanical being': 'robot',
      'angel with wings halo': 'angel',
      'demon devil dark creature': 'demon',
      'fairy small magical being wings': 'fairy',
      'dragon large winged reptile': 'dragon',
      'mermaid fish tail ocean': 'mermaid',
      'witch wizard magic user': 'witch',
      'knight warrior in armor': 'knight',
      'samurai japanese warrior': 'samurai',
      'ninja stealth assassin': 'ninja',
      'pirate sea adventurer': 'pirate',
      'vampire undead fangs': 'vampire',
      'elf pointed ears fantasy': 'elf',
    }
  },

  // ── Hair ──
  hair: {
    threshold: 0.18,
    maxTags: 2,
    labels: {
      'blonde yellow golden hair': 'blonde hair',
      'black dark hair': 'black hair',
      'brown hair': 'brown hair',
      'red ginger hair': 'red hair',
      'white silver gray hair': 'white hair',
      'blue colored hair': 'blue hair',
      'pink colored hair': 'pink hair',
      'purple violet hair': 'purple hair',
      'green colored hair': 'green hair',
      'long flowing hair': 'long hair',
      'short cropped hair': 'short hair',
      'twintails pigtails hair': 'twintails',
      'ponytail tied back hair': 'ponytail',
      'braided hair braid': 'braid',
      'curly wavy hair': 'curly hair',
      'bald no hair': 'bald',
    }
  },

  // ── Clothing / Outfit ──
  clothing: {
    threshold: 0.15,
    maxTags: 3,
    labels: {
      'dress gown formal wear': 'dress',
      'school uniform sailor outfit': 'school uniform',
      'military army uniform camouflage': 'military uniform',
      'suit formal business attire': 'suit',
      'armor plate mail protection': 'armor',
      'swimsuit bikini swimwear': 'swimsuit',
      'kimono japanese traditional clothing': 'kimono',
      'hoodie casual sweatshirt': 'hoodie',
      'jacket coat outerwear': 'jacket',
      'maid outfit apron costume': 'maid outfit',
      'wedding dress white bridal gown': 'wedding dress',
      'cape cloak flowing garment': 'cape',
      'hat headwear cap': 'hat',
      'glasses eyewear spectacles': 'glasses',
      'mask face covering': 'mask',
      'crown tiara royal headpiece': 'crown',
      'scarf wrapped around neck': 'scarf',
      'boots footwear shoes': 'boots',
      'wings on back feathered': 'wings',
      'horns on head': 'horns',
      'tail animal tail': 'tail',
      'nude naked bare skin nsfw': 'nude',
    }
  },

  // ── Pose / Expression ──
  pose: {
    threshold: 0.18,
    maxTags: 2,
    labels: {
      'sitting down seated': 'sitting',
      'standing upright': 'standing',
      'lying down reclining': 'lying down',
      'walking moving forward': 'walking',
      'running sprinting fast': 'running',
      'jumping leaping in air': 'jumping',
      'fighting combat martial arts pose': 'fighting pose',
      'dancing graceful movement': 'dancing',
      'kneeling on knees': 'kneeling',
      'arms crossed confident': 'arms crossed',
      'looking at viewer eye contact': 'looking at viewer',
      'looking away turned head': 'looking away',
      'from behind back view': 'from behind',
      'from side profile view': 'profile',
      'smiling happy cheerful': 'smiling',
      'crying sad tears': 'crying',
      'angry furious expression': 'angry',
      'surprised shocked expression': 'surprised',
      'serious stern expression': 'serious',
      'sleeping eyes closed resting': 'sleeping',
    }
  },

  // ── Environment / Setting ──
  environment: {
    threshold: 0.12,
    maxTags: 3,
    labels: {
      'forest trees woodland': 'forest',
      'mountain peaks rocky terrain': 'mountain',
      'ocean sea water waves': 'ocean',
      'desert sand dunes arid': 'desert',
      'snow ice winter frozen': 'snow',
      'rain wet stormy weather': 'rain',
      'sky clouds above': 'sky',
      'sunset orange golden hour': 'sunset',
      'sunrise morning dawn': 'sunrise',
      'night dark starry sky': 'night',
      'moon moonlight lunar': 'moon',
      'city urban buildings downtown': 'city',
      'street road alley pathway': 'street',
      'castle medieval fortress': 'castle',
      'ruins abandoned destroyed': 'ruins',
      'temple shrine sacred place': 'temple',
      'church cathedral religious building': 'church',
      'garden park flowers outdoors': 'garden',
      'field meadow grassland plains': 'field',
      'cave underground cavern': 'cave',
      'bridge crossing over water': 'bridge',
      'tower tall structure': 'tower',
      'space stars galaxy cosmos': 'space',
      'underwater deep sea ocean floor': 'underwater',
      'volcano lava eruption fire mountain': 'volcano',
      'waterfall cascading water cliff': 'waterfall',
      'lake pond still water reflection': 'lake',
      'river stream flowing water': 'river',
      'classroom school education room': 'classroom',
      'bedroom sleeping room bed': 'bedroom',
      'kitchen cooking room': 'kitchen',
      'library books shelves reading room': 'library',
      'office workspace desk computer': 'office',
      'stage theater performance spotlight': 'stage',
      'train station platform railway': 'train station',
      'cafe restaurant dining': 'cafe',
      'bathroom shower tiles': 'bathroom',
      'rooftop top of building view': 'rooftop',
    }
  },

  // ── Objects / Props ──
  objects: {
    threshold: 0.15,
    maxTags: 3,
    labels: {
      'sword blade weapon melee': 'sword',
      'gun firearm weapon shooting': 'gun',
      'bow and arrow archery': 'bow',
      'shield defensive round protection': 'shield',
      'staff magical wand scepter': 'staff',
      'book open reading pages': 'book',
      'flower bouquet petals bloom': 'flower',
      'car automobile vehicle driving': 'car',
      'motorcycle motorbike riding': 'motorcycle',
      'airplane aircraft flying plane': 'airplane',
      'ship boat sailing vessel': 'ship',
      'train locomotive railway': 'train',
      'bicycle bike cycling': 'bicycle',
      'spaceship spacecraft rocket': 'spaceship',
      'mecha giant robot mechanical suit': 'mecha',
      'phone smartphone mobile device': 'phone',
      'musical instrument guitar piano violin': 'musical instrument',
      'food meal dish plate eating': 'food',
      'drink cup glass beverage': 'drink',
      'candle flame fire light': 'candle',
      'mirror reflection glass': 'mirror',
      'clock time watch timepiece': 'clock',
      'umbrella rain parasol shade': 'umbrella',
      'flag banner waving fabric': 'flag',
      'chain lock metal links': 'chain',
      'lantern lamp light source glow': 'lantern',
      'throne royal ornate chair': 'throne',
      'treasure chest gold coins jewels': 'treasure',
      'crystal gem gemstone glowing stone': 'crystal',
      'skull bones skeleton death': 'skull',
      'butterfly insect wings delicate': 'butterfly',
      'cat feline pet': 'cat',
      'dog canine pet': 'dog',
      'horse equine riding': 'horse',
      'bird avian flying feathers': 'bird',
      'wolf wild canine': 'wolf',
      'fox vulpine wild animal': 'fox',
      'snake serpent reptile': 'snake',
      'fish aquatic swimming': 'fish',
    }
  },

  // ── Art Style ──
  style: {
    threshold: 0.15,
    maxTags: 2,
    labels: {
      'anime manga japanese animation style': 'anime',
      'photorealistic photograph real life photo': 'photorealistic',
      'digital painting digital art illustration': 'digital art',
      'oil painting traditional canvas brush strokes': 'oil painting',
      'watercolor painting soft washes transparent': 'watercolor',
      'pencil sketch hand drawn graphite': 'sketch',
      '3d rendered cgi computer graphics': '3d render',
      'pixel art retro 8bit 16bit game': 'pixel art',
      'cartoon comic bright exaggerated style': 'cartoon',
      'concept art design visualization': 'concept art',
      'ink drawing black white linework': 'ink',
      'pastel soft colors chalk art': 'pastel',
      'pop art bold colors halftone': 'pop art',
      'art nouveau organic flowing ornamental': 'art nouveau',
      'ukiyo-e japanese woodblock print': 'ukiyo-e',
      'chibi cute small deformed style': 'chibi',
      'realistic detailed lifelike rendering': 'realistic',
      'painterly loose brush strokes impressionistic': 'painterly',
      'low poly geometric simple 3d': 'low poly',
      'voxel blocky cubic 3d': 'voxel',
      'stained glass colorful translucent panels': 'stained glass',
      'graffiti street art spray paint urban': 'graffiti',
      'collage mixed media cut paper': 'collage',
    }
  },

  // ── Color / Palette ──
  color: {
    threshold: 0.20,
    maxTags: 2,
    labels: {
      'red dominant warm color palette': 'red theme',
      'blue dominant cool color palette': 'blue theme',
      'green nature verdant color palette': 'green theme',
      'purple violet magenta color palette': 'purple theme',
      'golden yellow warm color palette': 'golden',
      'pink soft warm rosy color': 'pink theme',
      'orange warm autumn color': 'orange theme',
      'monochrome black and white grayscale': 'monochrome',
      'sepia brown toned vintage': 'sepia',
      'neon bright glowing vivid colors': 'neon',
      'pastel soft muted light colors': 'pastel colors',
      'dark shadows low key deep blacks': 'dark palette',
      'vibrant saturated rich intense colors': 'vibrant',
      'muted desaturated subdued tones': 'muted tones',
      'rainbow multicolor spectrum': 'rainbow',
      'white bright clean minimal': 'white theme',
    }
  },

  // ── Lighting / Atmosphere ──
  lighting: {
    threshold: 0.15,
    maxTags: 2,
    labels: {
      'dramatic lighting strong shadows contrast': 'dramatic lighting',
      'soft diffused even gentle lighting': 'soft lighting',
      'backlit silhouette rim light': 'backlit',
      'golden hour warm sunlight late afternoon': 'golden hour',
      'studio lighting professional controlled light': 'studio lighting',
      'neon glow cyberpunk colored lights': 'neon lighting',
      'candlelight warm dim flickering': 'candlelight',
      'moonlight cool blue night illumination': 'moonlight',
      'volumetric light rays god rays beams': 'volumetric lighting',
      'foggy misty hazy atmospheric': 'fog',
      'lens flare bright light artifact': 'lens flare',
      'bioluminescent glowing organic light': 'bioluminescence',
    }
  },

  // ── Mood / Tone ──
  mood: {
    threshold: 0.18,
    maxTags: 2,
    labels: {
      'dark moody gloomy brooding': 'dark',
      'bright cheerful happy uplifting': 'bright',
      'peaceful calm serene tranquil': 'peaceful',
      'epic grand majestic impressive scale': 'epic',
      'eerie creepy unsettling horror': 'eerie',
      'melancholic sad nostalgic wistful': 'melancholic',
      'romantic love tender intimate': 'romantic',
      'mysterious enigmatic unknown': 'mysterious',
      'chaotic messy disordered destruction': 'chaotic',
      'elegant refined graceful sophisticated': 'elegant',
      'whimsical playful fun lighthearted': 'whimsical',
      'cinematic dramatic movie-like composition': 'cinematic',
      'dystopian post-apocalyptic ruined world': 'dystopian',
      'ethereal dreamlike otherworldly': 'ethereal',
      'cozy comfortable warm homey': 'cozy',
      'intense fierce powerful aggressive': 'intense',
    }
  },

  // ── Genre / Theme ──
  genre: {
    threshold: 0.15,
    maxTags: 2,
    labels: {
      'fantasy medieval magic swords castles': 'fantasy',
      'science fiction futuristic technology space': 'sci-fi',
      'cyberpunk neon dystopia tech noir': 'cyberpunk',
      'steampunk victorian gears brass machinery': 'steampunk',
      'horror scary dark terrifying': 'horror',
      'post-apocalyptic wasteland survival ruins': 'post-apocalyptic',
      'historical ancient period costume': 'historical',
      'modern contemporary present day': 'modern',
      'military war soldiers combat': 'military',
      'mecha giant robots mechanical suits': 'mecha',
      'magical girl transformation sparkle': 'magical girl',
      'slice of life everyday casual scene': 'slice of life',
      'christmas holiday festive winter celebration': 'christmas',
      'halloween spooky pumpkin costume': 'halloween',
      'underwater ocean depths aquatic world': 'underwater',
      'fairy tale storybook enchanted magical': 'fairy tale',
    }
  },

  // ── Composition / Camera ──
  composition: {
    threshold: 0.18,
    maxTags: 2,
    labels: {
      'close-up face portrait tight crop': 'close-up',
      'medium shot waist up': 'medium shot',
      'wide angle shot broad view': 'wide shot',
      'extreme close-up eye detail macro': 'extreme close-up',
      'dutch angle tilted camera': 'dutch angle',
      'low angle looking up from below': 'low angle',
      'high angle looking down from above': 'high angle',
      'fisheye lens distorted wide': 'fisheye',
      'depth of field bokeh blurred background': 'bokeh',
      'symmetrical centered balanced composition': 'symmetrical',
      'dynamic diagonal energetic composition': 'dynamic angle',
      'split screen two halves divided': 'split screen',
    }
  },
};

/**
 * Lazily initialize the CLIP pipeline (downloads model on first use ~600MB)
 */
async function getPipeline() {
  if (pipeline) return pipeline;

  if (pipelineLoading) {
    return new Promise((resolve) => pipelineQueue.push(resolve));
  }

  pipelineLoading = true;
  console.log('[Vision Tagger] Loading CLIP model (first run downloads ~600MB)...');

  try {
    const { pipeline: createPipeline } = await import('@huggingface/transformers');
    pipeline = await createPipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32');
    console.log('[Vision Tagger] CLIP model loaded successfully.');
    pipelineQueue.forEach(resolve => resolve(pipeline));
    pipelineQueue = [];
    return pipeline;
  } catch (err) {
    pipelineLoading = false;
    pipelineQueue.forEach(resolve => resolve(null));
    pipelineQueue = [];
    throw err;
  }
}

/**
 * Extract key terms from a BLIP caption to use as dynamic CLIP labels.
 * Filters out stop words and very short words.
 */
function extractCaptionLabels(caption) {
  if (!caption) return [];
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same',
    'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or',
    'if', 'while', 'this', 'that', 'these', 'those', 'it', 'its',
    'up', 'down', 'close', 'image', 'photo', 'picture', 'there',
  ]);

  // Adjectives that commonly precede nouns in captions
  const adjectives = new Set([
    'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'white', 'black',
    'silver', 'golden', 'brown', 'grey', 'dark', 'bright', 'colorful', 'neon', 'glowing',
    'large', 'small', 'big', 'tall', 'long', 'old', 'young', 'beautiful',
    'futuristic', 'modern', 'ancient', 'vintage', 'wooden', 'metal', 'glass',
    'sports', 'luxury', 'military', 'flying', 'robotic', 'mechanical',
    'asian', 'european', 'african', 'american',
  ]);

  const words = caption.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

  const labels = new Set();
  for (let i = 0; i < words.length; i++) {
    // Standalone nouns (skip adjectives alone — they're vague)
    if (!adjectives.has(words[i])) {
      labels.add(words[i]);
    }
    // Adjective + noun bigrams (these are the best labels)
    if (i < words.length - 1 && adjectives.has(words[i]) && !adjectives.has(words[i + 1])) {
      labels.add(`${words[i]} ${words[i + 1]}`);
    }
  }

  return Array.from(labels).slice(0, 12);
}

/**
 * Classify an image against all tag groups using CLIP.
 * If a caption is provided, also runs caption-guided classification.
 * @param {string} imagePath - Path to the image file (or thumbnail)
 * @param {string} [caption] - Optional BLIP caption for guided classification
 * @returns {Array<{name: string, category: string, score: number}>}
 */
async function classifyImage(imagePath, caption = null) {
  const classifier = await getPipeline();
  if (!classifier) throw new Error('CLIP pipeline not available');

  const tags = [];

  for (const [category, group] of Object.entries(TAG_GROUPS)) {
    try {
      const clipLabels = Object.keys(group.labels);
      const results = await classifier(imagePath, clipLabels);

      const topResults = results
        .filter(r => r.score >= group.threshold)
        .slice(0, group.maxTags);

      for (const result of topResults) {
        const tagName = group.labels[result.label] || result.label;
        tags.push({ name: tagName, category, score: result.score });
      }
    } catch (err) {
      console.error(`[Vision Tagger] Failed to classify ${category}:`, err.message);
    }
  }

  // Caption-guided classification: use BLIP caption terms as dynamic CLIP labels
  if (caption) {
    try {
      const captionLabels = extractCaptionLabels(caption);
      if (captionLabels.length > 0) {
        // Classify the image against caption-derived labels
        const results = await classifier(imagePath, captionLabels);
        const existingNames = new Set(tags.map(t => t.name));

        for (const result of results) {
          // Only add if high confidence and not already tagged
          if (result.score >= 0.20 && !existingNames.has(result.label)) {
            tags.push({ name: result.label, category: 'caption', score: result.score });
            existingNames.add(result.label);
          }
        }
      }
    } catch (err) {
      console.error('[Vision Tagger] Caption-guided classification failed:', err.message);
    }
  }

  return tags;
}

/**
 * Check if the CLIP model is loaded and ready
 */
function isReady() {
  return pipeline !== null;
}

/**
 * Get stats about the tag library
 */
function getTagLibraryStats() {
  let totalLabels = 0;
  const categories = {};
  for (const [category, group] of Object.entries(TAG_GROUPS)) {
    const count = Object.keys(group.labels).length;
    categories[category] = count;
    totalLabels += count;
  }
  return { totalLabels, categories };
}

module.exports = { classifyImage, getPipeline, isReady, getTagLibraryStats };
