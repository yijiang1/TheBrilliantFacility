const { test, expect } = require('@playwright/test');

async function clickWorld(page, x, y) {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + x / 1280 * box.width, box.y + y / 800 * box.height);
}
async function pair(browser) {
  const host = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const guest = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  for (const p of [host, guest]) {
    p.on('pageerror', e => errors.push(e.message));
    await p.route('**/discord.com/**', r => r.abort());
  }
  await host.goto('http://127.0.0.1:3000');
  await host.locator('#online-create').click();
  await expect(host.locator('#online-lobby')).toBeVisible();
  const invite = await host.locator('#online-invite').inputValue();
  await guest.goto(invite);
  await expect(guest.locator('#online-lobby')).toBeVisible();
  await host.locator('#online-ready').click(); await guest.locator('#online-ready').click();
  await host.locator('#online-start').click();
  for (const p of [host, guest]) await p.waitForFunction(() => coop.scene?.scene.key === 'ProposalReview');
  const card = await host.evaluate(() => ({ x: coop.scene.cards[0].bg.x, y: coop.scene.cards[0].bg.y }));
  await clickWorld(host, card.x, card.y);
  await expect.poll(() => guest.evaluate(() => coop.scene.cards[0].tick.text)).toBe('✓');
  await clickWorld(host, 640, 768);
  for (const p of [host, guest]) await p.waitForFunction(() => coop.scene?.scene.key === 'Game' && !coop.blocked);
  await guest.waitForFunction(() => coop.hasPosition);
  await guest.evaluate(() => document.activeElement.blur());
  return { host, guest, errors, async close() { await host.close(); await guest.close(); expect(errors).toEqual([]); } };
}
async function fixture(host) {
  await host.evaluate(() => {
    const s = coop.scene;
    s.time.removeAllEvents(); // Fixed scenario: no random proposals or hazards during assertions.
    s.beamDump = false; s.held = []; s.coopOther.held = [];
    s.pending = []; s.commitQueue = []; s.measSlots = []; s.prepSlotsFor = { prep: [], prep2: [] };
    s.active = [{ id: 100, name: 'Co-op test sample', tech: s.beamlineTechs[0], totalSamples: 1, rep: 20,
      done: 0, unstarted: 1, committed: true, labType: 'wet', npcSlot: 0,
      prepDurs: [.15], setupDurs: [.15], measDurs: [.15], leaveMs: 100000, leaveMsTotal: 100000 }];
    s.npcPos[0] = { x: s.CX, y: s.CY - 240 };
    s.px = s.CX + 230; s.py = s.CY;
    s.coopOther.px = s.CX; s.coopOther.py = s.CY - 240;
    s.refreshJobs(); s.refreshNPCs();
  });
}
async function place(host, who, key) {
  await host.evaluate(({who,key}) => {
    const s = coop.scene, p = who === 'host' ? s : s.coopOther, st = s.stDefs[key];
    p.px = st.boxCX ?? st.x; p.py = st.boxCY ?? st.y;
  }, {who,key});
}

test('invite links, independent movement, sample handoff and shared pipeline complete on both clients', async ({ browser }) => {
  const p = await pair(browser), {host,guest} = p;
  try {
    const x = await host.evaluate(() => coop.scene.coopOther.px);
    await guest.keyboard.down('ArrowRight'); await guest.waitForTimeout(300); await guest.keyboard.up('ArrowRight');
    await expect.poll(() => host.evaluate(() => coop.scene.coopOther.px)).not.toBe(x);
    await fixture(host);
    await guest.keyboard.press('Space', {delay:80});
    await expect.poll(() => host.evaluate(() => coop.scene.coopOther.held.length)).toBe(1);
    const id = await host.evaluate(() => coop.scene.coopOther.held[0].sampleId);
    await host.evaluate(() => { coop.scene.px = coop.scene.coopOther.px + 20; coop.scene.py = coop.scene.coopOther.py; });
    await guest.keyboard.press('e');
    await expect.poll(() => host.evaluate(() => coop.scene.held.length)).toBe(1);
    expect(await host.evaluate(() => coop.scene.held[0].sampleId)).toBe(id);
    await place(host, 'host', 'prep');
    await host.keyboard.press('Space', {delay:80});
    await expect.poll(() => host.evaluate(() => coop.scene.prepSlotsFor.prep[0]?.toStage)).toBe('prepped_ready');
    // A different player picks up the same sample from the shared station.
    await place(host, 'guest', 'prep'); await guest.keyboard.press('Space', {delay:80});
    await expect.poll(() => host.evaluate(() => coop.scene.coopOther.held[0]?.stage)).toBe('prepped');
    await place(host, 'guest', 'exp_setup_0'); await guest.keyboard.press('Space', {delay:80});
    await expect.poll(() => host.evaluate(() => coop.scene.measSlots[0]?.sampleId)).toBe(id);
    await place(host, 'host', 'meas_0'); await host.keyboard.press('Space', {delay:80});
    await expect.poll(() => host.evaluate(() => coop.scene.measSlots[0]?.toStage)).toBe('meas_ready');
    await host.keyboard.press('Space', {delay:80});
    await expect.poll(() => host.evaluate(() => coop.scene.totalSamples)).toBe(1);
    await expect.poll(() => guest.evaluate(() => coop.scene.totalSamples)).toBe(1);
    expect(await guest.evaluate(() => coop.scene.reputation)).toBe(20);
    await guest.screenshot({ path: 'test-results/online-coop.png' });
  } finally { await p.close(); }
});

test('competing pickups, distinct setup ownership, NPC departure and synchronized cycle transition', async ({ browser }) => {
  const p = await pair(browser), {host,guest} = p;
  try {
    await fixture(host);
    await host.evaluate(() => { const s=coop.scene; s.px=s.coopOther.px; s.py=s.coopOther.py; });
    await Promise.all([host.keyboard.press('Space', {delay:80}), guest.keyboard.press('Space', {delay:80})]);
    await expect.poll(() => host.evaluate(() => coop.scene.held.length + coop.scene.coopOther.held.length)).toBe(1);
    await host.evaluate(() => {
      const s=coop.scene;
      s.active[0].unstarted=0; s.active[0].totalSamples=2;
      s.active.push({...s.active[0], id:101,tech:s.beamlineTechs[1],npcSlot:1,totalSamples:1,setupDurs:[5]});
      s.held=[{sampleId:501,jobId:100,stage:'prepped'}];
      s.coopOther.held=[{sampleId:502,jobId:101,stage:'prepped'},{sampleId:503,jobId:100,stage:'prepped'}];
      s.active[0].setupDurs=[5];
    });
    await place(host,'host','exp_setup_0'); await host.keyboard.press('Space', {delay:80});
    await expect.poll(() => host.evaluate(() => coop.scene.doingExpSetup)).toBe(true);
    await place(host,'guest','exp_setup_0'); await guest.keyboard.press('Space', {delay:80});
    await guest.waitForTimeout(100);
    expect(await host.evaluate(() => coop.scene.coopOther.doingExpSetup)).toBe(false);
    await place(host,'guest','exp_setup_1'); await guest.keyboard.press('Space', {delay:80});
    await expect.poll(() => host.evaluate(() => coop.scene.coopOther.doingExpSetup)).toBe(true);
    expect(await host.evaluate(() => coop.scene.coopOther.setupSampleId)).toBe(502);
    // Force setup completion: it must consume the bound sample, not another prepped item.
    await host.evaluate(() => { const s=coop.scene; s.coopOther.held.reverse(); s.coopOther.expSetupProg=1; });
    await expect.poll(() => host.evaluate(() => coop.scene.measSlots.some(s=>s.sampleId===502 && s.blIdx===1))).toBe(true);
    expect(await host.evaluate(() => coop.scene.coopOther.held[0].sampleId)).toBe(503);
    await host.evaluate(() => coop.scene.userNpcLeaves(coop.scene.active.find(j=>j.id===100)));
    await expect.poll(() => host.evaluate(() => coop.scene.held.length + coop.scene.coopOther.held.length)).toBe(0);
    await host.evaluate(() => coop.scene.endYear());
    for (const page of [host,guest]) await page.waitForFunction(() => coop.scene?.scene.key==='CycleEnd');
    const hostText=await host.evaluate(()=>coop.scene.children.list.filter(o=>o.type==='Text').map(o=>o.text));
    await expect.poll(()=>guest.evaluate(()=>coop.scene.children.list.filter(o=>o.type==='Text').map(o=>o.text))).toEqual(hostText);
    expect(await guest.evaluate(()=>coop.scene.input.enabled)).toBe(false);
    await host.evaluate(()=>{coop.scene.botChooseAction('paper');coop.scene.botContinue();});
    for (const page of [host,guest]) await page.waitForFunction(()=>coop.scene?.scene.key==='ProposalReview');
    const card=await host.evaluate(()=>({x:coop.scene.cards[0].bg.x,y:coop.scene.cards[0].bg.y}));
    await clickWorld(host,card.x,card.y); await clickWorld(host,640,768);
    for (const page of [host,guest]) await page.waitForFunction(()=>coop.scene?.scene.key==='Game' && coop.scene.cycle===2);
    await fixture(host); await guest.keyboard.press('Space',{delay:80});
    await expect.poll(()=>host.evaluate(()=>coop.scene.coopOther.held.length)).toBe(1);
  } finally { await p.close(); }
});

test('guest can pause and resume; reload reconnects without losing inventory; host loss freezes timers', async ({ browser }) => {
  const p=await pair(browser), {host,guest}=p;
  try {
    await fixture(host); await guest.keyboard.press('Space', {delay:80});
    await expect.poll(()=>host.evaluate(()=>coop.scene.coopOther.held.length)).toBe(1);
    await guest.keyboard.press('Escape');
    await expect.poll(()=>host.evaluate(()=>coop.scene.gamePaused)).toBe(true);
    await guest.keyboard.press('Escape');
    await expect.poll(()=>host.evaluate(()=>coop.scene.gamePaused)).toBe(false);
    await guest.reload(); await guest.waitForFunction(()=>coop.scene?.scene.key==='Game' && !coop.blocked && coop.hasPosition);
    expect(await guest.evaluate(()=>coop.scene.held.length)).toBe(1);
    // Host socket outage: preserve the in-memory simulation and automatically reconnect.
    await host.evaluate(()=>coop.ws.close());
    await expect.poll(()=>host.evaluate(()=>coop.blocked)).toBe(true);
    const remaining=await host.evaluate(()=>coop.scene.active[0].leaveMs);
    await host.waitForTimeout(250);
    expect(await host.evaluate(()=>coop.scene.active[0].leaveMs)).toBe(remaining);
    await host.waitForFunction(()=>!coop.blocked);
    await guest.waitForFunction(()=>!coop.blocked);
    expect(await host.evaluate(()=>coop.scene.coopOther.held.length)).toBe(1);
  } finally { await p.close(); }
});

test('solo play still starts without a room', async ({ page }) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); await page.locator('#online-solo').click();
  await page.waitForFunction(()=>game.scene.isActive('Tutorial'));
  await page.evaluate(()=>game.scene.getScene('Tutorial')._startGame());
  await page.waitForFunction(()=>game.scene.isActive('ProposalReview'));
  await page.evaluate(()=>{ const s=game.scene.getScene('ProposalReview');s.selected=[0];s.startCycle(); });
  await page.waitForFunction(()=>game.scene.isActive('Game'));
  expect(await page.evaluate(()=>coop.enabled)).toBe(false);
  expect(await page.evaluate(()=>game.scene.getScene('Game').coopOther)).toBe(null);
  expect(errors).toEqual([]);
});

test('solo player can reopen mode selection and resume the same session', async ({ page }) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); await page.locator('#online-solo').click();
  await page.evaluate(()=>game.scene.getScene('Tutorial')._startGame());
  await page.waitForFunction(()=>game.scene.isActive('ProposalReview'));
  await page.locator('#solo-menu').click();
  await expect(page.locator('#online-entry')).toBeVisible();
  await expect(page.locator('#online-solo')).toHaveText('Continue solo');
  expect(await page.evaluate(()=>game.scene.getScene('ProposalReview').time.paused)).toBe(true);
  await page.locator('#online-solo').click();
  await expect(page.locator('#online-panel')).toBeHidden();
  expect(await page.evaluate(()=>game.scene.isActive('ProposalReview'))).toBe(true);
  expect(await page.evaluate(()=>game.scene.getScene('ProposalReview').time.paused)).toBe(false);
  expect(errors).toEqual([]);
});


test('leaving a guest session restores solo input and preserves the solo save', async ({browser}) => {
  const p=await pair(browser), {guest}=p;
  try {
    await guest.evaluate(()=>localStorage.setItem('tbf_save', JSON.stringify({sentinel:'solo-save'})));
    await guest.locator('#online-exit').click();
    await expect(guest.locator('#online-entry')).toBeVisible();
    await guest.locator('#online-solo').click();
    expect(await guest.evaluate(()=>JSON.parse(localStorage.getItem('tbf_save')).sentinel)).toBe('solo-save');
    await guest.evaluate(()=>game.scene.getScene('Tutorial')._startGame());
    await guest.waitForFunction(()=>game.scene.isActive('ProposalReview'));
    await guest.evaluate(()=>{ const s=game.scene.getScene('ProposalReview');s.selected=[0];s.startCycle(); });
    await guest.waitForFunction(()=>game.scene.isActive('Game'));
    expect(await guest.evaluate(()=>game.scene.getScene('Game').input.keyboard.enabled)).toBe(true);
    await guest.keyboard.press('Escape',{delay:80});
    await expect.poll(()=>guest.evaluate(()=>game.scene.getScene('Game').gamePaused)).toBe(true);
  } finally { await p.close(); }
});
