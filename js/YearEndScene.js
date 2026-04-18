// ════════════════════════════════════════════════════════════════
class YearEndScene extends Phaser.Scene {
  constructor(){super('YearEnd');}
  create(d){
    const g=this.add.graphics();
    g.fillStyle(0xeef4fc); g.fillRect(0,0,GW,GH);
    g.fillStyle(0xfafcff,0.95); g.fillRoundedRect(GW/2-290,50,580,490,12);
    g.lineStyle(1,0x8aaabb); g.strokeRoundedRect(GW/2-290,50,580,490,12);

    const cycleStr = `CYCLE ${d.cycleInYear}  ·  YEAR ${d.year}`;
    this.add.text(GW/2,100,cycleStr,
      {font:'14px Courier New',color:'#2a7aaa',letterSpacing:2}).setOrigin(0.5);
    this.add.text(GW/2,124,'BEAMTIME CYCLE COMPLETE',
      {font:'bold 26px Courier New',color:'#0d3a8a'}).setOrigin(0.5);
    this.add.text(GW/2,154,'─── Cycle Review ───',
      {font:'12px Courier New',color:'#4a8aaa'}).setOrigin(0.5);

    const stats=[
      ['Samples Characterised',    String(d.yearSamples),'#1a5a3a'],
      ['Reputation (cumulative)',   `⭐ ${d.reputation}`, '#7a5000'],
      ['Ring Stability (next year)',`${Math.round(d.ringBase)}%`,
        d.ringBase>60?'#1a6a2a':d.ringBase>30?'#aa6600':'#cc1100'],
    ];
    stats.forEach(([label,val,col],i)=>{
      const y=196+i*58;
      this.add.text(GW/2-16,y,label+':',{font:'16px Courier New',color:'#4a8aaa'}).setOrigin(1,0.5);
      this.add.text(GW/2+16,y,val,{font:'bold 20px Courier New',color:col}).setOrigin(0,0.5);
    });

    const outcomes=[
      {min:8,txt:'📄 Nature / Science — very likely!', col:'#7a5000'},
      {min:5,txt:'📄 High-impact journal — likely',     col:'#7a5000'},
      {min:3,txt:'📄 Journal paper — possible',         col:'#6a4400'},
      {min:1,txt:'📄 Conference abstract — possible',   col:'#6a4400'},
      {min:0,txt:'❌ No publication expected',          col:'#cc1100'},
    ];
    const out=outcomes.find(o=>d.yearSamples>=o.min);
    this.add.text(GW/2,378,out.txt,{font:'17px Courier New',color:out.col}).setOrigin(0.5);

    if(d.ringBase<60){
      this.add.text(GW/2,416,`⚠  Ring ageing — ${Math.round(d.ringBase)}% stability next year`,
        {font:'14px Courier New',color:'#aa4400'}).setOrigin(0.5);
      this.add.text(GW/2,434,'Consider a Source Upgrade to stabilise the ring.',
        {font:'13px Courier New',color:'#7a3300'}).setOrigin(0.5);
    }

    // Rep penalties from unfinished committed proposals
    if (d.penalties && d.penalties.length > 0) {
      let py = d.ringBase < 60 ? 454 : 416;
      this.add.text(GW/2, py, '⚠  Unfulfilled commitments:',
        {font:'bold 13px Courier New', color:'#cc2200'}).setOrigin(0.5);
      d.penalties.forEach((p, i) => {
        this.add.text(GW/2, py + 16 + i*14, `${p.name}: ${p.penalty} rep`,
          {font:'12px Courier New', color:'#cc4422'}).setOrigin(0.5);
      });
    }

    const nextCycleInYear = (d.cycleInYear % 3) + 1;
    const nextYear        = nextCycleInYear === 1 ? d.year + 1 : d.year;
    const nextCycle       = d.cycle + 1;
    const btnLbl = nextCycleInYear === 1
      ? `[ START CYCLE 1 / YEAR ${nextYear} ]`
      : `[ START CYCLE ${nextCycleInYear} / YEAR ${d.year} ]`;
    const btn=this.add.text(GW/2,484,btnLbl,
      {font:'bold 18px Courier New',color:'#0a7a44'})
      .setOrigin(0.5).setInteractive({useHandCursor:true});
    btn.on('pointerover',()=>btn.setStyle({color:'#0a9a55'}));
    btn.on('pointerout', ()=>btn.setStyle({color:'#0a7a44'}));
    btn.on('pointerdown',()=>this.scene.start('ProposalReview',{
      cycle:nextCycle, cycleInYear:nextCycleInYear, year:nextYear,
      reputation:d.reputation, ringBase:d.ringBase,
    }));

    this.add.text(GW/2,GH-16,'THE BRILLIANT FACILITY  —  M1 Prototype  |  GDD v0.3',
      {font:'12px Courier New',color:'#4a8aaa'}).setOrigin(0.5);
  }
}
