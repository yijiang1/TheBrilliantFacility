// ════════════════════════════════════════════════════════════════
//  CYCLE END — shown after every cycle (quick summary + upgrade shop)
// ════════════════════════════════════════════════════════════════
class CycleEndScene extends Phaser.Scene {
  constructor(){super('CycleEnd');}
  init(d){
    this.d = d;
    this.upgrades = JSON.parse(JSON.stringify(d.upgrades || {
      prepCap:1, measCap:1,
      prepSpeedMap:{prep:1.0,prep2:1.0}, measSpeedMap:[1.0,1.0,1.0,1.0],
      extraJobSlots:0, postdocs:0, postdocLevels:[], postdocNames:[], ringMaint:false, npcPositioning:false,
    }));
    // Migrate old single-value format from saved games
    if (typeof this.upgrades.prepSpeedMap !== 'object' || Array.isArray(this.upgrades.prepSpeedMap)) {
      const v = this.upgrades.prepSpeed || 1.0;
      this.upgrades.prepSpeedMap = {prep:v, prep2:v};
    }
    if (!Array.isArray(this.upgrades.measSpeedMap)) {
      const v = this.upgrades.measSpeed || 1.0;
      this.upgrades.measSpeedMap = [v,v,v,v];
    }
    if (!Array.isArray(this.upgrades.postdocLevels)) {
      const oldLv = this.upgrades.postdocLevel || 1;
      this.upgrades.postdocLevels = Array(this.upgrades.postdocs || 0).fill(oldLv);
    }
    if (!Array.isArray(this.upgrades.postdocNames)) {
      this.upgrades.postdocNames = [];
      const count = this.upgrades.postdocs || 0;
      for (let i = 0; i < count; i++)
        this.upgrades.postdocNames.push(pickPostdocName(this.upgrades.postdocNames));
    }
    // Calculate available funding
    const isYearEnd = d.cycleInYear === 3;
    if (isYearEnd) {
      // Award new yearly funding, cap carryover from last year
      const carryover = Math.min(d.funding || 0, 100000);
      const newFunding = 200000 + Math.floor((d.reputation||0) * 500);
      const postdocCost = (this.upgrades.postdocs || 0) * 100000;
      this.funding = carryover + newFunding - postdocCost;
      this.newFundingMsg = `New year grant: 💰${fmtK(newFunding)}  (carryover: 💰${fmtK(carryover)}${postdocCost > 0 ? `  postdocs: -💰${fmtK(postdocCost)}` : ''})`;
    } else {
      this.funding = d.funding || 0;
      this.newFundingMsg = null;
    }
    this.spent = 0;
  }
  create(){
    const d = this.d;
    const g = this.add.graphics();
    g.fillStyle(0xeef4fc); g.fillRect(0,0,GW,GH);
    g.fillStyle(0xdce8f4); g.fillRect(0,0,GW,64);
    g.fillStyle(0x00aacc,0.3); g.fillRect(0,62,GW,2);

    this.add.text(GW/2,20,`CYCLE ${d.cycleInYear} / YEAR ${d.year} — COMPLETE`,
      {font:'bold 20px Courier New',color:'#0d3a8a'}).setOrigin(0.5);
    if (d.cycleInYear===3)
      this.add.text(GW/2,44,'✦  YEAR END  ✦',
        {font:'bold 13px Courier New',color:'#aa7700',letterSpacing:3}).setOrigin(0.5);

    // Quick stats (left column)
    const LX = 60, SY = 80;
    this.add.text(LX,SY,'CYCLE RESULTS',{font:'bold 13px Courier New',color:'#2a5a8a',letterSpacing:2});
    const stats=[
      [`Samples done:`,  String(d.yearSamples)],
      [`Reputation:`,    `⭐ ${d.reputation}`],
      [`Ring stability:`,`${Math.round(d.ringBase)}%`],
    ];
    stats.forEach(([k,v],i)=>{
      this.add.text(LX,    SY+22+i*20, k, {font:'13px Courier New',color:'#3a5a7a'});
      const valTxt = this.add.text(LX+160,SY+22+i*20, v, {font:'bold 13px Courier New',color:'#0d2a4a'});
      if (i === 1) this.repValTxt = valTxt; // reputation row — keep ref for live update
    });

    let nextY = SY + 90;

    // Penalties
    if(d.penalties&&d.penalties.length>0){
      this.add.text(LX,nextY,'Unfulfilled:',{font:'12px Courier New',color:'#cc2200'});
      d.penalties.forEach((p,i)=>
        this.add.text(LX+110,nextY+i*14,`${p.name} ${p.penalty} rep`,
          {font:'12px Courier New',color:'#cc4422'}));
      nextY += 20 + d.penalties.length * 14;
    }

    // Cycle analytics (auto-instrumentation)
    if (d.proposalsDone !== undefined) {
      this.add.text(LX, nextY, '── CYCLE ANALYTICS ──',
        {font:'10px Courier New', color:'#6a9abb', letterSpacing:1});
      const effTime   = d.yearSamples > 0 ? (CYCLE_SEC / d.yearSamples).toFixed(1) : '—';
      const repPerSmp = d.yearSamples > 0 ? ((d.repEarned||0) / d.yearSamples).toFixed(1) : '—';
      const aRows = [
        `${d.proposalsDone} done  ·  ${d.proposalsPartial} partial  ·  ${d.penalties.length} failed`,
        `${effTime}s/samp  ·  ${repPerSmp} rep/samp`,
      ];
      aRows.forEach((v, i) => {
        this.add.text(LX, nextY+14+i*16, v, {font:'bold 11px Courier New', color:'#0d2a4a'});
      });
      nextY += 14 + aRows.length * 16 + 18;
    }

    // Paper outcome
    const outcomes=[
      {min:8,txt:'📄 Nature / Science likely'},
      {min:5,txt:'📄 High-impact journal'},
      {min:3,txt:'📄 Journal paper'},
      {min:1,txt:'📄 Conference abstract'},
      {min:0,txt:'❌ No publication'},
    ];
    const out=outcomes.find(o=>d.yearSamples>=o.min);
    this.add.text(LX,nextY,out.txt,{font:'13px Courier New',color:'#6a4400'});
    nextY += 28;

    // New year funding banner
    if(this.newFundingMsg){
      this.add.rectangle(LX-8,nextY,320,26,0xfef8e0).setOrigin(0,0).setStrokeStyle(1,0xccaa44);
      this.add.text(LX+4,nextY+11,this.newFundingMsg,{font:'12px Courier New',color:'#7a5500'}).setOrigin(0,0.5);
      nextY += 40;
    }

    // ── BETWEEN-CYCLE ACTION CHOICE ──────────────────────────
    const AY = nextY;
    this.add.text(LX, AY, 'BETWEEN-CYCLE ACTION', {font:'bold 13px Courier New',color:'#2a5a8a',letterSpacing:2});
    this.add.text(LX, AY+16, 'Choose one action before continuing:', {font:'11px Courier New',color:'#5a7a9a'});

    this.actionChosen = false;
    const repGain = Math.min(30, 10 + (d.yearSamples || 0) * 2);
    const hasPostdoc = (this.upgrades.postdocs || 0) > 0;
    const pdLevels = this.upgrades.postdocLevels || [];
    const pdNames  = this.upgrades.postdocNames  || [];
    const trainable = pdLevels.map((_, i) => i).filter(i => pdLevels[i] < 3);
    const canTrain = hasPostdoc && trainable.length > 0;

    const trainDesc = () => {
      if (!hasPostdoc) return 'No postdoc hired';
      if (!canTrain)   return 'All at max level';
      return trainable.map(i => `${pdNames[i]} Lv${pdLevels[i]}→${pdLevels[i]+1}`).join('\n');
    };

    const actions = [
      {
        key: 'paper', icon: '📄', label: 'Write Paper',
        desc: `+${repGain} reputation`,
        available: true,
        selectMode: false,
        apply: () => {
          this.d.reputation = (this.d.reputation || 0) + repGain;
          if (this.repValTxt) this.repValTxt.setText(`⭐ ${this.d.reputation}`).setStyle({color:'#0a8a2a'});
          return `✓ Paper published! +${repGain} rep (now ${this.d.reputation})`;
        },
      },
      {
        key: 'train', icon: '🎓', label: 'Train Postdoc',
        desc: trainDesc(),
        available: canTrain,
        // selectMode=true when >1 trainable postdoc so the player picks
        selectMode: canTrain && trainable.length > 1,
        apply: () => {
          const idx = trainable[0];
          this.upgrades.postdocLevels[idx]++;
          return `✓ ${pdNames[idx]} trained to Lv2!`;
        },
        applySelect: (pdIdx) => {
          this.upgrades.postdocLevels[pdIdx]++;
          return `✓ ${pdNames[pdIdx]} trained to Lv2!`;
        },
        selectOptions: trainable.map(i => ({ name: pdNames[i], pdIdx: i })),
      },
    ];

    this.actionCards = [];
    this._pdSelectObjs = [];
    const CW = 138, CH = 90;  // must fit 2 cards + 12px gap left of divider at RX-12=358
    actions.forEach((act, i) => {
      const cx = LX + i * (CW + 12);
      const cy = AY + 42;
      const bg = this.add.rectangle(cx, cy, CW, CH, act.available ? 0xfafcff : 0xeeeeee)
        .setOrigin(0, 0).setStrokeStyle(1, act.available ? 0xaabbcc : 0xcccccc);
      const icon = this.add.text(cx + CW/2, cy + 16, act.icon, {font:'24px Courier New'}).setOrigin(0.5);
      const lbl = this.add.text(cx + CW/2, cy + 42, act.label, {font:'bold 12px Courier New', color: act.available ? '#1a5a8a' : '#999999'}).setOrigin(0.5);
      const dsc = this.add.text(cx + CW/2, cy + 58, act.desc, {font:'10px Courier New', color: act.available ? '#2a7a3a' : '#999999', wordWrap:{width:CW-10}, align:'center'}).setOrigin(0.5, 0);
      const result = this.add.text(cx + CW/2, cy + CH + 6, '', {font:'bold 10px Courier New', color:'#0a8a5a'}).setOrigin(0.5);

      const completeChoice = (msg) => {
        this.actionChosen = true;
        result.setText(msg);
        bg.setFillStyle(0xd0f0d0).setStrokeStyle(2, 0x2a9a2a);
        this.actionCards.forEach((c, j) => {
          if (j === i) return;
          c.bg.setFillStyle(0xeeeeee).setStrokeStyle(1, 0xcccccc);
          c.lbl.setStyle({color:'#999999'});
          c.icon.setAlpha(0.4);
        });
        this.contBtn.setText('[ CONTINUE TO PROPOSAL REVIEW ]').setStyle({color:'#0a7a44'});
        this.contBtn.setInteractive({useHandCursor:true});
        this.contBtn.on('pointerover',()=>this.contBtn.setStyle({color:'#0a9a55'}));
        this.contBtn.on('pointerout', ()=>this.contBtn.setStyle({color:'#0a7a44'}));
        this.contBtn.on('pointerdown',()=>this.nextScene());
      };

      if (act.available) {
        bg.setInteractive({useHandCursor:true});
        bg.on('pointerover', () => { if (!this.actionChosen) bg.setFillStyle(0xd0e4f8); });
        bg.on('pointerout', () => { if (!this.actionChosen) bg.setFillStyle(0xfafcff); });
        bg.on('pointerdown', () => {
          if (this.actionChosen) return;

          if (act.selectMode) {
            // Show postdoc-selection sub-panel below the action cards
            bg.setFillStyle(0xd0e4f8);
            result.setText('Choose postdoc ↓');
            this._pdSelectObjs.forEach(o => o.destroy());
            this._pdSelectObjs = [];

            const selY = cy + CH + 26;
            const prompt = this.add.text(cx, selY, 'Train which postdoc?',
              {font:'10px Courier New', color:'#335577'}).setOrigin(0, 0);
            this._pdSelectObjs.push(prompt);

            act.selectOptions.forEach((opt, si) => {
              const bx = cx + si * 72;
              const by = selY + 16;
              const sbg = this.add.rectangle(bx, by, 66, 26, 0xfafcff)
                .setOrigin(0, 0).setStrokeStyle(1, 0x2266cc);
              const stxt = this.add.text(bx + 33, by + 13, opt.name,
                {font:'bold 10px Courier New', color:'#1a5a8a'}).setOrigin(0.5);
              sbg.setInteractive({useHandCursor:true});
              sbg.on('pointerover', () => sbg.setFillStyle(0xd0e4f8));
              sbg.on('pointerout',  () => sbg.setFillStyle(0xfafcff));
              sbg.on('pointerdown', () => {
                this._pdSelectObjs.forEach(o => o.destroy());
                this._pdSelectObjs = [];
                completeChoice(act.applySelect(opt.pdIdx));
              });
              this._pdSelectObjs.push(sbg, stxt);
            });
          } else {
            completeChoice(act.apply());
          }
        });
      }
      this.actionCards.push({bg, icon, lbl, dsc, result});
    });

    // ── UPGRADE SHOP (right side) ────────────────────────────
    const RX = 370;
    this.add.text(RX,SY,'UPGRADES',{font:'bold 13px Courier New',color:'#2a5a8a',letterSpacing:2});
    this.fundingTxt = this.add.text(RX+220,SY,`💰 ${fmtK(this.funding)} available`,
      {font:'bold 13px Courier New',color:'#7a5000'});

    // Divider
    g.lineStyle(1,0xccddee);
    g.lineBetween(RX-12,SY-4,RX-12,GH-60);

    const PREP_LABS = [
      { pk:'prep',  label:'Wet Lab 🧪' },
      { pk:'prep2', label:'Dry Lab 🔩' },
    ];
    const BL_LABELS = (d.beamlineTechs || ['BL-1','BL-2','BL-3','BL-4'])
      .map((tech, i) => ({ idx:i, label:`BL-${i+1} (${tech})` }));

    this.boughtThisCycle = new Set();

    const UPGRADES = [
      // ── Per-lab prep speed (2 cards) ──
      ...PREP_LABS.map(lab => ({
        key: `prepSpeed_${lab.pk}`,
        label: `Faster Prep — ${lab.label}`,
        desc: () => {
          const pct = Math.round((1 - this.upgrades.prepSpeedMap[lab.pk]) * 100);
          return `Prep time −5% per purchase\n${pct}% faster (max 50%)`;
        },
        cost: 10000,
        oncePerCycle: true,
        canBuy: () => this.upgrades.prepSpeedMap[lab.pk] > 0.51 && !this.boughtThisCycle.has(`prepSpeed_${lab.pk}`),
        apply:  () => { this.upgrades.prepSpeedMap[lab.pk] = Math.max(0.50, this.upgrades.prepSpeedMap[lab.pk] - 0.05); },
      })),
      // ── Per-beamline measurement speed (4 cards) ──
      ...BL_LABELS.map(bl => ({
        key: `measSpeed_${bl.idx}`,
        label: `Faster Meas — ${bl.label}`,
        desc: () => {
          const pct = Math.round((1 - this.upgrades.measSpeedMap[bl.idx]) * 100);
          return `Measurement −5% per purchase\n${pct}% faster (max 50%)`;
        },
        cost: 50000,
        oncePerCycle: true,
        canBuy: () => this.upgrades.measSpeedMap[bl.idx] > 0.51 && !this.boughtThisCycle.has(`measSpeed_${bl.idx}`),
        apply:  () => { this.upgrades.measSpeedMap[bl.idx] = Math.max(0.50, this.upgrades.measSpeedMap[bl.idx] - 0.05); },
      })),
      // ── Other upgrades ──
      { key:'extraJob',  label:'Hire Postdoc',    desc:'+1 postdoc NPC helper', cost:100000,
        oncePerCycle: true,
        canBuy:()=>!this.boughtThisCycle.has('extraJob'),
        apply:()=>{
          this.upgrades.postdocs = (this.upgrades.postdocs || 0) + 1;
          const name = pickPostdocName(this.upgrades.postdocNames || []);
          (this.upgrades.postdocNames  = this.upgrades.postdocNames  || []).push(name);
          (this.upgrades.postdocLevels = this.upgrades.postdocLevels || []).push(1);
        } },
      { key:'prepCap',   label:'Prep Room × 2',   desc:'Handle 2 samples at once',     cost:150000,
        show:()=>d.year > 1,
        canBuy:()=>this.upgrades.prepCap<2,       apply:()=>this.upgrades.prepCap=2 },
      { key:'ringMaint', label:'Ring Maintenance', desc:'Restores +5% ring stability/cycle\n(net +3% after −2 decay)', cost:80000,
        show:()=>d.year > 1,
        canBuy:()=>!this.upgrades.ringMaint,      apply:()=>this.upgrades.ringMaint=true },
      { key:'npcPositioning', label:'User Coordination', desc:'Users wait halfway between their\nprep lab and beamline — less walking', cost:100000,
        show:()=>d.year > 1,
        canBuy:()=>!this.upgrades.npcPositioning, apply:()=>this.upgrades.npcPositioning=true },
    ];

    const visibleUpgrades = UPGRADES.filter(u => !u.show || u.show());

    this.upgButtons = [];
    // Fit 2 columns within the right panel without overflowing the canvas
    const COL_GAP = 14;
    const CARD_W  = Math.floor((GW - RX - COL_GAP - 20) / 2); // right margin 20px
    const CARD_H  = 86;
    const ROW_H   = CARD_H + 12;

    visibleUpgrades.forEach((u, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ux  = RX + col * (CARD_W + COL_GAP);
      const uy  = SY + 26 + row * ROW_H;

      const bg    = this.add.rectangle(ux, uy, CARD_W, CARD_H, 0xfafcff)
                             .setOrigin(0, 0).setStrokeStyle(1, 0xaabbcc);
      const lbl   = this.add.text(ux + 12, uy + 11, u.label,
                      {font:'bold 14px Courier New', color:'#1a5a8a'});
      const getDesc = () => typeof u.desc === 'function' ? u.desc() : u.desc;
      const dsc   = this.add.text(ux + 12, uy + 31, getDesc(),
                      {font:'11px Courier New', color:'#3a6a8a',
                       wordWrap:{width: CARD_W - 80}});
      const cst   = this.add.text(ux + 12, uy + CARD_H - 19, `💰 ${fmtK(u.cost)}`,
                      {font:'bold 12px Courier New', color:'#9a6600'});
      const btn   = this.add.text(ux + CARD_W - 10, uy + CARD_H / 2 + 6, '[ BUY ]',
                      {font:'bold 13px Courier New', color:'#0a8a5a'}).setOrigin(1, 0.5);
      const ownedLabel = typeof u.desc === 'function' ? '✗ MAX' : '✓ OWNED';
      const owned = this.add.text(ux + CARD_W - 10, uy + CARD_H / 2 + 6, ownedLabel,
                      {font:'bold 12px Courier New', color:'#4a9a6a'}).setOrigin(1, 0.5).setAlpha(0);

      bg.setInteractive({useHandCursor:true});
      btn.setInteractive({useHandCursor:true});
      const doClick = () => {
        if (!u.canBuy()) { return; }
        if (this.funding - this.spent < u.cost) {
          this.fundingTxt.setText(`💰 ${fmtK(this.funding-this.spent)} — not enough!`).setStyle({color:'#cc3300'});
          this.time.delayedCall(1200, () => this.fundingTxt.setText(`💰 ${fmtK(this.funding-this.spent)} available`).setStyle({color:'#7a5000'}));
          return;
        }
        this.spent += u.cost;
        u.apply();
        if (u.oncePerCycle) this.boughtThisCycle.add(u.key);
        this.fundingTxt.setText(`💰 ${fmtK(this.funding-this.spent)} available`);
        dsc.setText(getDesc());
        this.refreshUpgButtons();
      };
      bg.on('pointerdown', doClick); btn.on('pointerdown', doClick);
      bg.on('pointerover', () => { if (u.canBuy()) bg.setFillStyle(0xd0e4f8); });
      bg.on('pointerout',  () => bg.setFillStyle(u.canBuy() ? 0xfafcff : 0xeeeeee));
      this.upgButtons.push({u, bg, lbl, dsc, cst, btn, owned});
    });
    this.refreshUpgButtons();

    // Auto-save cycle stats to localStorage + remote telemetry
    const _statRecord = {
      ts:              new Date().toISOString(),
      year:            d.year,
      cycle:           d.cycle,
      cycleInYear:     d.cycleInYear,
      samples:         d.yearSamples,
      proposalsDone:   d.proposalsDone   ?? null,
      proposalsPartial:d.proposalsPartial ?? null,
      failed:          d.penalties?.length ?? 0,
      repEarned:       d.repEarned        ?? null,
      reputation:      d.reputation,
      funding:         d.funding,
      ring:            d.ringBase,
      upgrades:        d.upgrades,
      activeUpgrades:  _activeUpgradeNames(d.upgrades),
      playDurationSec: d.playDurationSec ?? null,
      proposalLog:     d.proposalLog     ?? [],
      sampleLog:       d.sampleLog       ?? [],
    };
    saveStatRecord(_statRecord);
    sendTelemetry(_statRecord);

    // Export / Clear stats buttons (dev tools)
    const expBtn = this.add.text(LX, GH-44, '[ Export Stats JSON ]',
      {font:'10px Courier New', color:'#4a8aba'})
      .setInteractive({useHandCursor:true});
    expBtn.on('pointerover',  () => expBtn.setStyle({color:'#0060cc'}));
    expBtn.on('pointerout',   () => expBtn.setStyle({color:'#4a8aba'}));
    expBtn.on('pointerdown',  () => exportStats());

    const clrBtn = this.add.text(LX, GH-30, '[ Clear Stats ]',
      {font:'10px Courier New', color:'#aa6644'})
      .setInteractive({useHandCursor:true});
    clrBtn.on('pointerover',  () => clrBtn.setStyle({color:'#cc2200'}));
    clrBtn.on('pointerout',   () => clrBtn.setStyle({color:'#aa6644'}));
    clrBtn.on('pointerdown',  () => { clearStats(); clrBtn.setText('[ Cleared ]'); });

    // Continue button — starts DISABLED until an action is chosen
    this.contBtn = this.add.text(GW/2, GH-28, '[ CHOOSE AN ACTION ABOVE TO CONTINUE ]',
      {font:'bold 14px Courier New',color:'#888888'})
      .setOrigin(0.5);

    this.add.text(GW/2,GH-12,'THE BRILLIANT FACILITY  —  M1 Prototype',
      {font:'12px Courier New',color:'#aabbcc'}).setOrigin(0.5);
  }

  refreshUpgButtons(){
    this.upgButtons.forEach(({u,bg,btn,owned})=>{
      const canBuy = u.canBuy();
      bg.setFillStyle(canBuy ? 0xfafcff : 0xeeeeee);
      bg.setStrokeStyle(1, canBuy ? 0xaabbcc : 0xcccccc);
      btn.setAlpha(canBuy ? 1 : 0);
      owned.setAlpha(canBuy ? 0 : 1);
    });
  }

  nextScene(){
    const nextCycleInYear = (this.d.cycleInYear % 3) + 1;
    const nextYear        = nextCycleInYear === 1 ? this.d.year + 1 : this.d.year;
    const nextCycle       = this.d.cycle + 1;
    const saveData = {
      cycle:nextCycle, cycleInYear:nextCycleInYear, year:nextYear,
      reputation:this.d.reputation, ringBase:this.d.ringBase,
      funding: this.funding - this.spent,
      upgrades: this.upgrades,
      beamlineTechs: this.d.beamlineTechs,
    };
    saveGame(saveData);
    this.scene.start('ProposalReview', saveData);
  }
}
