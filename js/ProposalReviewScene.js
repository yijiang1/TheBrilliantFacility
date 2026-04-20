// ════════════════════════════════════════════════════════════════
//  PROPOSAL REVIEW SCENE
//  Player selects which proposals to commit to before the cycle.
// ════════════════════════════════════════════════════════════════
class ProposalReviewScene extends Phaser.Scene {
  constructor() { super('ProposalReview'); }

  init(d) {
    this.cycle       = (d&&d.cycle)       || 1;
    this.cycleInYear = (d&&d.cycleInYear) || 1;
    this.year        = (d&&d.year)        || 1;
    this.reputation  = (d&&d.reputation)  || 0;
    this.ringBase    = (d&&d.ringBase)    || 100;
    this.funding     = (d&&d.funding)     !== undefined ? d.funding : 400;
    this.upgrades    = (d&&d.upgrades)    || {prepCap:1,measCap:1,prepSpeed:1.0,measSpeed:1.0,extraJobSlots:0,postdocs:0,postdocLevel:1,ringMaint:false};
    // Beamline technique assignment: shuffled once per run, persists across cycles
    if (d && d.beamlineTechs) {
      this.beamlineTechs = d.beamlineTechs;
    } else {
      this.beamlineTechs = pickBeamlineTechs(this.year||1);
    }
  }

  create() {
    this.selected = [];   // indices of selected proposals
    this.proposals = this.generateProposals(8);

    // Background
    const g = this.add.graphics();
    g.fillStyle(0xeef4fc); g.fillRect(0,0,GW,GH);
    g.fillStyle(0xdce8f4); g.fillRect(0,0,GW,64);
    g.fillStyle(0x00aacc,0.3); g.fillRect(0,62,GW,2);

    // Header
    this.add.text(GW/2, 24, 'THE BRILLIANT FACILITY',
      {font:'bold 26px Courier New', color:'#0d3a8a'}).setOrigin(0.5);
    this.add.text(GW/2, 48, `CYCLE ${this.cycleInYear} / YEAR ${this.year}  —  PROPOSAL REVIEW`,
      {font:'bold 14px Courier New', color:'#2a5a8a', letterSpacing:2}).setOrigin(0.5);

    // Instruction
    this.add.text(GW/2, 85,
      'Select any proposals to commit this cycle. Only 3 run simultaneously — extras queue up. Unfinished commitments cost reputation.',
      {font:'14px Courier New', color:'#2a3a4a', align:'center'}).setOrigin(0.5);

    // Proposal cards — 2 rows × 4 cols
    this.cards = [];
    const cols = 4, rows = 2;
    const cw = 270, ch = 200, pad = 24;
    const startX = (GW - (cols*cw + (cols-1)*pad)) / 2 + cw/2;
    const startY = 220;

    for (let i = 0; i < this.proposals.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const cx  = startX + col*(cw+pad);
      const cy  = startY + row*(ch+pad);
      this.buildCard(i, cx, cy, cw, ch);
    }

    // Start button
    this.startBtn = this.add.text(GW/2, GH-30, '[ START CYCLE — 0 SELECTED ]',
      {font:'bold 16px Courier New', color:'#334455'})
      .setOrigin(0.5).setDepth(5);

    this.refreshCards();
  }

  generateProposals(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const apps = getAvailableApps(this.year||1);
      const app  = apps[Math.floor(Math.random()*apps.length)];
      const tech = this.beamlineTechs[Math.floor(Math.random()*this.beamlineTechs.length)];
      const samples = Phaser.Math.Between(app.samples[0], app.samples[1]);
      const rep = app.rep + (samples-1)*8 + Phaser.Math.Between(-3,3);
      // Penalty for 0 done: proportional to rep value
      const penalty = Math.round(rep * 0.35);
      const sampleNames = pickSampleNames(app.name, samples);
      out.push({ name:app.name, tech, samples, sampleNames, rep, penalty, labType: app.lab || 'dry' });
    }
    return out;
  }

  buildCard(idx, cx, cy, cw, ch) {
    const p = this.proposals[idx];
    const blIdx = this.beamlineTechs.indexOf(p.tech);
    const blCol = blIdx >= 0 ? BL_HEX[blIdx] : 0x888888;
    const blTxt = blIdx >= 0 ? BL_TXT[blIdx] : '#4a5a6a';
    const labIcon = p.labType === 'wet' ? '🧪' : '🔩';

    const bg   = this.add.rectangle(cx, cy, cw, ch, 0xfafcff).setStrokeStyle(1, 0xaabbcc);
    const sel  = this.add.rectangle(cx, cy, cw, ch, 0x1a6aaa, 0).setStrokeStyle(0);
    // Left accent stripe matching beamline color
    const accent = this.add.rectangle(cx - cw/2 + 3, cy, 6, ch - 8, blCol).setOrigin(0.5);
    const name = this.add.text(cx, cy-60, `${labIcon} ${p.name}`,
      {font:'bold 18px Courier New', color:'#1a5a8a', wordWrap:{width:cw-30}, align:'center'}).setOrigin(0.5);
    const tech = this.add.text(cx, cy-34, `${p.tech}${blIdx >= 0 ? ` (BL-${blIdx+1})` : ''}`,
      {font:'bold 14px Courier New', color:blTxt, wordWrap:{width:cw-20}, align:'center'}).setOrigin(0.5);

    // Upgrade hint for this beamline / lab
    const prepKey = p.labType === 'wet' ? 'prep' : 'prep2';
    const prepSpeedMap = this.upgrades.prepSpeedMap || {prep:1.0, prep2:1.0};
    const measSpeedMap = this.upgrades.measSpeedMap || [1.0,1.0,1.0,1.0];
    const prepPct = Math.round((1 - (prepSpeedMap[prepKey] || 1.0)) * 100);
    const measPct = blIdx >= 0 ? Math.round((1 - (measSpeedMap[blIdx] || 1.0)) * 100) : 0;
    const upgParts = [];
    if (prepPct > 0) upgParts.push(`prep −${prepPct}%`);
    if (measPct > 0) upgParts.push(`meas −${measPct}%`);
    const upgHint = upgParts.length > 0 ? `⚡ ${upgParts.join('  ')}` : '';
    this.add.text(cx, cy-18, upgHint,
      {font:'10px Courier New', color:'#2a7a2a', align:'center'}).setOrigin(0.5);

    const repTxt = this.add.text(cx-cw/2+24, cy-8, `⭐ +${p.rep} rep`,
      {font:'bold 14px Courier New', color:'#b38600'});
    const lineH = 16;
    const sampleLines = p.sampleNames.map((n, i) => (i === 0 ? `📦 ${n}` : `   ${n}`)).join('\n');
    const batchTxt = this.add.text(cx-cw/2+24, cy+14, sampleLines,
      {font:'bold 13px Courier New', color:'#0a8a5a', lineSpacing: 2});
    const penY = cy + 14 + p.samples * lineH + 4;
    const penTxt = this.add.text(cx-cw/2+24, penY, `⚠ −${p.penalty} rep if 0 done`,
      {font:'bold 12px Courier New', color:'#aa3300'});

    const tick = this.add.text(cx+cw/2-24, cy-60, '',
      {font:'bold 24px Courier New', color:'#1a8a3a'}).setOrigin(0.5);

    // Click to select/deselect
    bg.setInteractive({useHandCursor:true});
    bg.on('pointerover', () => { if(!this.selected.includes(idx)) bg.setFillStyle(0xeef6ff); });
    bg.on('pointerout',  () => { if(!this.selected.includes(idx)) bg.setFillStyle(0xfafcff); });
    bg.on('pointerdown', () => this.toggleCard(idx));
    sel.setInteractive({useHandCursor:true});
    sel.on('pointerdown', () => this.toggleCard(idx));

    this.cards.push({bg, sel, name, tech, repTxt, batchTxt, penTxt, tick, accent});
  }

  toggleCard(idx) {
    if (this.selected.includes(idx)) {
      this.selected = this.selected.filter(i=>i!==idx);
    } else {
      this.selected.push(idx);
    }
    this.refreshCards();
  }

  refreshCards() {
    this.cards.forEach((c, i) => {
      const on = this.selected.includes(i);
      c.bg.setFillStyle(on ? 0xd0e4f8 : 0xfafcff);
      c.bg.setStrokeStyle(on ? 2 : 1, on ? 0x1a6aaa : 0xaabbcc);
      c.sel.setFillStyle(on ? 0x1a6aaa : 0xffffff).setAlpha(on ? 0.08 : 0);
      c.tick.setText(on ? '✓' : '');
    });

    const n = this.selected.length;
    if (n === 0) {
      this.startBtn.setText('[ START CYCLE — 0 SELECTED ]').setStyle({color:'#888888'});
      this.startBtn.removeInteractive();
    } else {
      this.startBtn.setText(`[ START CYCLE WITH ${n} PROPOSAL${n>1?'S':''} ]`)
        .setStyle({color:'#0a7a44'});
      this.startBtn.setInteractive({useHandCursor:true});
      this.startBtn.off('pointerdown');
      this.startBtn.on('pointerover', ()=>this.startBtn.setStyle({color:'#0a9a55'}));
      this.startBtn.on('pointerout',  ()=>this.startBtn.setStyle({color:'#0a7a44'}));
      this.startBtn.on('pointerdown', ()=>this.startCycle());
    }
  }

  startCycle() {
    const committed = this.selected.map(i => this.proposals[i]);
    this.scene.start('Game', {
      cycle:       this.cycle,
      cycleInYear: this.cycleInYear,
      year:        this.year,
      reputation:  this.reputation,
      ringBase:    this.ringBase,
      funding:     this.funding,
      upgrades:    this.upgrades,
      beamlineTechs: this.beamlineTechs,
      committedProposals: committed,
    });
  }
}
