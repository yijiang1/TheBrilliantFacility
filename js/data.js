// ════════════════════════════════════════════════════════════════
//  THE BRILLIANT FACILITY — M1 Prototype
//
//  Workflow per sample:
//    1. Walk to user NPC → [Space] collect raw sample into inventory
//    2. Walk to Prep Table → [Space] deposit → auto-processes 2.4s
//    3. Walk to Prep Table → [Space] pick up prepped sample
//    4. Walk to Experiment Setup → [Space] quick 2s player action (holding sample)
//    5. Walk to Control Room → [Space] deposit → auto-measures 3s
//    6. Walk to Control Room → [Space] pick up result → sample complete!
// ════════════════════════════════════════════════════════════════

const VERSION = 'v0.1.4';

const fmtK = n => n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);

const POSTDOC_NAMES = [
  'Alex','Sam','Jordan','Casey','Morgan','Riley','Quinn','Avery',
  'Drew','Hayden','Reese','Blake','Jamie','Cameron','Dylan',
  'Skyler','Parker','Taylor','Mika','Elliot','Barry','Stefan','Mathew',
];
function pickPostdocName(usedNames = []) {
  const pool = POSTDOC_NAMES.filter(n => !usedNames.includes(n));
  const src = pool.length ? pool : POSTDOC_NAMES;
  return src[Math.floor(Math.random() * src.length)];
}

let GW = Math.max(960, window.innerWidth);
let GH = Math.max(600, window.innerHeight);
const DPR = Math.min(window.devicePixelRatio || 1, 3);
const CYCLE_SEC     = 180;   // 3 min real time = 90 days game time
const DAYS_PER_CYCLE = 90;
const MAX_ACTIVE         = 5;   // base simultaneous job slots
const MAX_SLOTS          = 5;   // max slots rendered in UI
const PROPOSAL_LIFE = 40;
const MAX_HELD      = 3;   // player inventory size

// ── Telemetry — paste a Discord webhook URL here to receive cycle stats ──
const TELEMETRY_WEBHOOK = 'https://discord.com/api/webhooks/1493440793720127520/wdWz5JBTrfG4dWlZV2qXo34cemGJ7feEYVIm7Li79Drrt-Raq-Gcym6YogBhnpkMqtZy';

// Palette
const C = {
  hudBg:   0xdce8f4,  // light blue-grey HUD
  prepRoom:0xeef4fc,  // very light blue prep room (matches background)
  hutch:   0xe8efe5,  // light greenish grey hutch
  wall:    0xaabbcc,  // wall line
  door:    0x7a8a9a,  // door gap
  boardBg: 0xf4f8ff,  // proposal board
  jobsBg:  0xf8fcff,  // jobs panel
  prepSt:  0x8abadd,  // prep station — light blue
  lockSt:  0xdd8a8a,  // experiment setup — light red
  measSt:  0x8addaa,  // measurement — light teal
  player:  0xffeedd,  // lab coat
  hat:     0xdd9911,  // hard hat
};

// Job slot colours
const JOB_HEX = [0x1a6aaa, 0xaa4a10, 0x2a9a5a, 0x8a2a9a, 0x8a6a10, 0x1a8a8a, 0x8a1a3a, 0x4a4a4a];  // up to 8 slots
const JOB_TXT = ['#1a5a9a','#9a3a08','#1a8a4a','#6a1a8a','#7a5a08', '#1a6a6a', '#6a1a2a', '#3a3a3a'];  // up to 8 slots

// Beamline colours — fixed per BL slot index (BL-1..4), independent of which job is running
const BL_HEX = [0x0077dd, 0xcc4400, 0x009944, 0x8800cc];  // BL-1 blue, BL-2 orange, BL-3 teal, BL-4 purple
const BL_TXT = ['#0066cc', '#bb3300', '#007733', '#7700bb'];

// ── Generation data ─────────────────────────────────────────────────────────
// Each generation adds new techniques and application types.
// Techs/apps from earlier generations remain available in later ones.
// startYear: game year at which this generation becomes active.
const GENERATION_DATA = [
  {
    gen: 1,
    name: '1st Generation',
    era: '1960s – 1970s',
    source: 'Bending Magnet (parasitic)',
    desc: 'Parasitic beamlines at particle physics accelerators',
    startYear: 1,
    techs: [
      'Powder Diffraction',   // PXRD — phase ID from polycrystalline patterns
      'X-ray Fluorescence',   // XRF  — elemental analysis via characteristic emission
      'Laue Diffraction',     // Laue — single-crystal orientation, polychromatic beam
      'X-ray Topography',     // XRT  — crystal defect & strain field imaging
    ],
    apps: [
      {name:'Mineral ID',        samples:[1,2], rep:12, lab:'dry'},
      {name:'Steel Alloy',       samples:[1,2], rep:16, lab:'dry'},
      {name:'Crystal Structure', samples:[1,3], rep:20, lab:'wet'},
      {name:'Pigment Analysis',  samples:[1,2], rep:10, lab:'wet'},
    ],
  },
  {
    gen: 2,
    name: '2nd Generation',
    era: '1970s – 1980s',
    source: 'Dedicated Bending Magnet Storage Ring',
    desc: 'First purpose-built synchrotron light sources',
    startYear: 4,
    techs: [
      'EXAFS / XANES',          // XAS — local atomic structure & oxidation state
      'SAXS',                   // SAXS — nanostructure via small-angle scattering
      'Protein Crystallography', // MX  — macromolecular structure determination
    ],
    apps: [
      {name:'Catalyst Study',        samples:[2,3], rep:14, lab:'dry'},
      {name:'Protein Fragment',      samples:[2,3], rep:17, lab:'wet'},
      {name:'Environmental Sample',  samples:[1,3], rep:11, lab:'dry'},
      {name:'Pharmaceutical',        samples:[2,4], rep:20, lab:'wet'},
      {name:'Battery Electrode',     samples:[2,3], rep:15, lab:'dry'},
    ],
  },
  {
    gen: 3,
    name: '3rd Generation',
    era: '1990s – 2010s',
    source: 'Undulator / Wiggler Insertion Devices',
    desc: 'High-brilliance beams enabling nanoscale science',
    startYear: 7,
    techs: [
      'Micro-CT',       // µCT  — 3D internal imaging at micron resolution
      'Micro-XRF',      // µXRF — 2D elemental mapping with micron-scale resolution
      'XRD Analysis',   // XRD  — high-resolution strain, texture & phase mapping
    ],
    apps: [
      {name:'Drug Target',     samples:[2,4], rep:16, lab:'wet'},
      {name:'Geological Core', samples:[3,5], rep:20, lab:'dry'},
      {name:'Archaeological',  samples:[1,3], rep:13, lab:'wet'},
      {name:'Semiconductor',   samples:[2,4], rep:17, lab:'dry'},
      {name:'Nanocomposite',   samples:[2,4], rep:18, lab:'wet'},
    ],
  },
  {
    gen: 4,
    name: '4th Generation',
    era: '2020s – present',
    source: 'Diffraction-Limited Storage Ring (DLSR)',
    desc: 'Near-perfect coherence enabling atomic-resolution imaging',
    startYear: 11,
    techs: [
      'Ptychography',          // Ptycho  — coherent imaging beyond lens limits via phase retrieval
      'Serial Crystallography', // SX     — structure from thousands of microcrystals in flow
      'Phase Contrast',         // PCI    — 3D soft-matter imaging without staining
      'Time-Resolved XAS',      // TR-XAS — chemical dynamics at picosecond timescales
      'Coherent Imaging',       // CDI    — lens-free imaging using fully coherent X-rays
    ],
    apps: [
      {name:'Virus Particle',     samples:[3,5], rep:18, lab:'wet'},
      {name:'Quantum Material',   samples:[2,4], rep:16, lab:'dry'},
      {name:'Operando Battery',   samples:[2,4], rep:15, lab:'dry'},
      {name:'Neural Tissue',      samples:[3,5], rep:17, lab:'wet'},
      {name:'Ultrafast Dynamics', samples:[2,3], rep:20, lab:'wet'},
      {name:'Nano-device',        samples:[2,4], rep:16, lab:'dry'},
    ],
  },
];

// Returns the current generation number (1–4) for a given game year
function getGeneration(year) {
  let gen = 1;
  for (const g of GENERATION_DATA) { if (year >= g.startYear) gen = g.gen; }
  return gen;
}

// All apps available up to and including the current generation
function getAvailableApps(year) {
  const genNum = getGeneration(year);
  const apps = [];
  for (const g of GENERATION_DATA) { if (g.gen <= genNum) apps.push(...g.apps); }
  return apps;
}

// All technique names available up to the current generation
function getAvailableTechs(year) {
  const genNum = getGeneration(year);
  const techs = [];
  for (const g of GENERATION_DATA) { if (g.gen <= genNum) techs.push(...g.techs); }
  return techs;
}

// Pick 4 random techs from the available pool to assign to the 4 beamlines
function pickBeamlineTechs(year) {
  const pool = [...getAvailableTechs(year)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 4);
}

// ── Sample name pools (per application type) ────────────────────────────────
const SAMPLE_NAME_POOLS = {
  'Mineral ID':          ['Quartz','Calcite','Feldspar','Magnetite','Olivine','Pyrite','Apatite','Zircon'],
  'Steel Alloy':         ['Fe-17Cr','Ni-Mo-V','304-SS','Duplex','Fe-Mn','17-4PH','H-C276','IN-625'],
  'Crystal Structure':   ['CuBTC','ZIF-8','MOF-5','MIL-101','UiO-66','HKUST','AlBDC','ZnMOF'],
  'Pigment Analysis':    ['Azurite','Vermilion','Ochre','Verdigris','Smalt','Orpiment','Realgar','Gypsum'],
  'Catalyst Study':      ['Pt/Al₂O₃','Fe-ZSM5','Ru-TiO₂','Cu-CeO₂','Ni-SiO₂','Pd-C','Co-Mo','V₂O₅'],
  'Protein Fragment':    ['Lysozyme','Ferritin','RuBisCO','Collagen','Albumin','Myoglobin','Catalase','Casein'],
  'Environmental Sample':['River-A','Soil-B','Sediment','Aerosol','Runoff','Leachate','Biofilm','Dust'],
  'Pharmaceutical':      ['Ibuprofen','Aspirin','Metformin','Penicillin','Caffeine','Naproxen','Furosemide','Tamoxifen'],
  'Battery Electrode':   ['LiFePO₄','NMC-811','LCO','NCA','LMO','LNMO','Si-C anode','Li-metal'],
  'Drug Target':         ['Kinase-A','GPCR-B','Protease','Ion Chan.','Receptor','Integrin','Polymerase','Ubiquitin'],
  'Geological Core':     ['Basalt','Shale','Granite','Limestone','Dolomite','Sandstone','Gabbro','Peridotite'],
  'Archaeological':      ['Bronze','Glaze','Bone','Pigment','Ceramic','Iron slag','Textile','Resin'],
  'Semiconductor':       ['Si-p+','GaAs','InP','GaN','SiC','Ge-SOI','HgCdTe','AlGaN'],
  'Nanocomposite':       ['CNT/epoxy','TiO₂/PS','Fe₃O₄/PEG','ZnO/PVDF','Ag/gelatin','AuNP/silk','Gr/nylon','CeO₂/PE'],
  'Virus Particle':      ['Adeno-2','VSV-G','SARS-2','HIV-Gag','T4 phage','MS2','TMV','HBV core'],
  'Quantum Material':    ['FeSe','CrI₃','MoS₂','Bi₂Se₃','LaAlO₃','SmB₆','α-RuCl₃','YBa₂Cu₃O₇'],
  'Operando Battery':    ['LCO cell','NMC pouch','LFP coin','Si anode','Na-ion','K-ion','Li-S','All-solid'],
  'Neural Tissue':       ['Cortex-A','Hippocmp.','Cerebellm.','Striatum','Brainstem','Retina','Cochlea','Spinal'],
  'Ultrafast Dynamics':  ['Fe(CO)₅','Mn₂(CO)₁₀','Ru-dye','VO₂','GeTe','MnAs','BLUF dom.','PYP'],
  'Nano-device':         ['FinFET','GAA-FET','MEMS-1','PCM cell','RRAM node','MTJ stack','SAW dev.','LED epi'],
};

// Pick `count` unique sample names for a given application type
function pickSampleNames(appName, count) {
  const pool = SAMPLE_NAME_POOLS[appName];
  if (!pool || !pool.length) {
    return Array.from({length: count}, (_, i) => `S-${String(i+1).padStart(2,'0')}`);
  }
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// Processing durations
const DUR_PREP_MIN  = 1.0;   // 0.5 game day
const DUR_PREP_MAX  = 2.0;   // 1.0 game day
const DUR_EXP_SETUP_MIN = 1.0;  // 0.5 game day  } real: 0.5–1.0 day — sample loading, hutch search, door close & interlock
const DUR_EXP_SETUP_MAX = 2.0;  // 1.0 game day  }
const DUR_MEAS_MIN  = 2.0;  // 1.0 game day  } placeholder — real range to be confirmed by research
const DUR_MEAS_MAX  = 10.0; // 5.0 game days }

// ── sample stages ──────────────────────────────────────────
// Each held sample: { jobId, stage }
// stage: 'raw' | 'prepped' | 'exp_setup_done'
//
// Station slot:   { jobId, fromStage, doneAt, toStage }
// ─────────────────────────────────────────────────────────────
