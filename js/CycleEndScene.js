// ════════════════════════════════════════════════════════════════
//  CYCLE END — shown after every cycle (quick summary + upgrade shop)
// ════════════════════════════════════════════════════════════════
class CycleEndScene extends Phaser.Scene {
  constructor(){super('CycleEnd');}
  init(d){
    this.d = d;
    this.upgrades = JSON.parse(JSON.stringify(d.upgrades || {
      prepCap:1, measCap:1, prepSpeed:1.0, measSpeed:1.0,
      extraJobSlots:0, postdocs:0, postdocLevel:1, ringMaint:false,
    }));
    // Calculate available funding
    const isYearEnd = d.cycleInYear === 3;
    if (isYearEnd) {
      // Award new yearly funding, cap carryover from last year
      const carryover = Math.min(d.funding || 0, 200);
      const newFunding = 400 + Math.floor((d.reputation||0) * 3);
      this.funding = carryover + newFunding;
      this.newFundingMsg = `New year grant: 💰${newFunding}  (carryover: 💰${carryover})`;
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
      const fb = this.add.rectangle(LX-8,nextY,320,26,0xfef8e0).setOrigin(0,0).setStrokeStyle(1,0xccaa44);
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
    const pdLevel = this.upgrades.postdocLevel || 1;
    const canTrain = hasPostdoc && pdLevel < 2;

    const actions = [
      {
        key: 'paper', icon: '📄', label: 'Write Paper',
        desc: `+${repGain} reputation`,
        available: true,
        apply: () => {
          this.d.reputation = (this.d.reputation || 0) + repGain;
          if (this.repValTxt) this.repValTxt.setText(`⭐ ${this.d.reputation}`).setStyle({color:'#0a8a2a'});
          return `✓ Paper published! +${repGain} rep (now ${this.d.reputation})`;
        }
      },
      {
        key: 'train', icon: '🎓', label: 'Train Postdoc',
        desc: hasPostdoc ? (canTrain ? `Level ${pdLevel} → ${pdLevel+1} (follows you)` : `Already Level ${pdLevel} (max)`) : 'No postdoc hired',
        available: canTrain,
        apply: () => {
          this.upgrades.postdocLevel = (this.upgrades.postdocLevel || 1) + 1;
          return `✓ Postdoc trained to Level ${this.upgrades.postdocLevel}!`;
        }
      },
    ];

    this.actionCards = [];
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

      if (act.available) {
        bg.setInteractive({useHandCursor:true});
        bg.on('pointerover', () => { if (!this.actionChosen) bg.setFillStyle(0xd0e4f8); });
        bg.on('pointerout', () => { if (!this.actionChosen) bg.setFillStyle(0xfafcff); });
        bg.on('pointerdown', () => {
          if (this.actionChosen) return;
          this.actionChosen = true;
          const msg = act.apply();
          result.setText(msg);
          bg.setFillStyle(0xd0f0d0).setStrokeStyle(2, 0x2a9a2a);
          // Gray out the other card
          this.actionCards.forEach((c, j) => {
            if (j === i) return;
            c.bg.setFillStyle(0xeeeeee).setStrokeStyle(1, 0xcccccc);
            c.lbl.setStyle({color:'#999999'});
            c.icon.setAlpha(0.4);
          });
          // Enable continue button
          this.contBtn.setText('[ CONTINUE TO PROPOSAL REVIEW ]').setStyle({color:'#0a7a44'});
          this.contBtn.setInteractive({useHandCursor:true});
          this.contBtn.on('pointerover',()=>this.contBtn.setStyle({color:'#0a9a55'}));
          this.contBtn.on('pointerout', ()=>this.contBtn.setStyle({color:'#0a7a44'}));
          this.contBtn.on('pointerdown',()=>this.nextScene());
        });
      }
      this.actionCards.push({bg, icon, lbl, dsc, result});
    });

    // ── UPGRADE SHOP (right side) ────────────────────────────
    const RX = 370;
    this.add.text(RX,SY,'UPGRADES',{font:'bold 13px Courier New',color:'#2a5a8a',letterSpacing:2});
    this.fundingTxt = this.add.text(RX+220,SY,`💰 ${this.funding} available`,
      {font:'bold 13px Courier New',color:'#7a5000'});

    // Divider
    g.lineStyle(1,0xccddee);
    g.lineBetween(RX-12,SY-4,RX-12,GH-60);

    const UPGRADES = [
      { key:'prepCap',      label:'Prep Room × 2',    desc:'Handle 2 samples at once',    cost:180,
        canBuy:()=>this.upgrades.prepCap<2,            apply:()=>this.upgrades.prepCap=2 },
      { key:'measCap',      label:'Measurement × 2',  desc:'Run 2 measurements simultaneously', cost:220,
        canBuy:()=>this.upgrades.measCap<2,            apply:()=>this.upgrades.measCap=2 },
      { key:'prepSpeed',    label:'Faster Prep',       desc:'Prep time −5%',               cost:120,
        canBuy:()=>this.upgrades.prepSpeed>0.96,       apply:()=>this.upgrades.prepSpeed=Math.max(0.95,this.upgrades.prepSpeed-0.05) },
      { key:'measSpeed',    label:'Faster Measurement', desc:'Measurement time −5%',        cost:140,
        canBuy:()=>this.upgrades.measSpeed>0.96,       apply:()=>this.upgrades.measSpeed=Math.max(0.95,this.upgrades.measSpeed-0.05) },
      { key:'extraJob',     label:'Hire Postdoc',      desc:'+1 postdoc NPC helper (max 2)', cost:150,
        canBuy:()=>(this.upgrades.postdocs||0)<2,      apply:()=>this.upgrades.postdocs=(this.upgrades.postdocs||0)+1 },
      { key:'ringMaint',    label:'Ring Maintenance',  desc:'Halves ring stability decay', cost:100,
        canBuy:()=>!this.upgrades.ringMaint,           apply:()=>this.upgrades.ringMaint=true },
    ];

    this.upgButtons = [];
    // Fit 2 columns within the right panel without overflowing the canvas
    const COL_GAP = 14;
    const CARD_W  = Math.floor((GW - RX - COL_GAP - 20) / 2); // right margin 20px
    const CARD_H  = 86;
    const ROW_H   = CARD_H + 12;

    UPGRADES.forEach((u, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ux  = RX + col * (CARD_W + COL_GAP);
      const uy  = SY + 26 + row * ROW_H;

      const bg    = this.add.rectangle(ux, uy, CARD_W, CARD_H, 0xfafcff)
                             .setOrigin(0, 0).setStrokeStyle(1, 0xaabbcc);
      const lbl   = this.add.text(ux + 12, uy + 11, u.label,
                      {font:'bold 14px Courier New', color:'#1a5a8a'});
      const dsc   = this.add.text(ux + 12, uy + 31, u.desc,
                      {font:'11px Courier New', color:'#3a6a8a',
                       wordWrap:{width: CARD_W - 80}});
      const cst   = this.add.text(ux + 12, uy + CARD_H - 19, `💰 ${u.cost}`,
                      {font:'bold 12px Courier New', color:'#9a6600'});
      const btn   = this.add.text(ux + CARD_W - 10, uy + CARD_H / 2 + 6, '[ BUY ]',
                      {font:'bold 13px Courier New', color:'#0a8a5a'}).setOrigin(1, 0.5);
      const owned = this.add.text(ux + CARD_W - 10, uy + CARD_H / 2 + 6, '✓ OWNED',
                      {font:'bold 12px Courier New', color:'#4a9a6a'}).setOrigin(1, 0.5).setAlpha(0);

      bg.setInteractive({useHandCursor:true});
      btn.setInteractive({useHandCursor:true});
      const doClick = () => {
        if (!u.canBuy()) { return; }
        if (this.funding - this.spent < u.cost) {
          this.fundingTxt.setText(`💰 ${this.funding-this.spent} — not enough!`).setStyle({color:'#cc3300'});
          this.time.delayedCall(1200, () => this.fundingTxt.setText(`💰 ${this.funding-this.spent} available`).setStyle({color:'#7a5000'}));
          return;
        }
        this.spent += u.cost;
        u.apply();
        this.fundingTxt.setText(`💰 ${this.funding-this.spent} available`);
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
