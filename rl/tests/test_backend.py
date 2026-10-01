import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from balance_config import BalanceConfig, applications, ROOT
from campaign import Campaign, automatic_plan
from experiments import run_cycle, simulate, paired_difference, write_report
from facility_env import FacilityEnv, Job, HeldItem, MeasSlot, PrepSlot, LOC_IDX, ACTION_WAIT


def empty(**overrides):
    config = BalanceConfig(n_jobs=0, rapid_review=False, beam_stops=False).changed(**overrides)
    env = FacilityEnv(config=config)
    env.reset(seed=7)
    return env


def add_job(env, samples=2, rep=21, **kwargs):
    job = Job(0, 'test', 'wet', 0, samples, rep, **kwargs)
    env.jobs[0] = job
    if job.npc_slot >= 0:
        env._npc_slots_used.add(job.npc_slot)
    return job


class RuleTests(unittest.TestCase):
    def test_completion_only_and_no_rounding_loss(self):
        e = empty(); j = add_job(e)
        for expected in [0, 21]:
            e.meas_slots = [MeasSlot(0, 0, 0, 1, True, True)]
            e._interact_ctrl('bl0_ctrl')
            self.assertEqual(e.reputation, expected)
        self.assertTrue(j.completed)
        e._finish_job(j)
        self.assertEqual(e.reputation, 21)

    def test_shape_reward_does_not_change_score(self):
        e = empty(); add_job(e, npc_slot=0)
        e.loc='npc_0'
        e.step(LOC_IDX['npc_0'])
        self.assertGreater(e._step_reward, 0)
        self.assertEqual(e.reputation, 0)

    def test_shaping_cannot_reward_abandoned_work(self):
        e=empty();j=add_job(e,npc_slot=0,leave_ms=1000,leave_ms_total=1000)
        e.loc='npc_0'
        _,reward,_,_,_=e.step(LOC_IDX['npc_0'])
        self.assertGreater(reward,0)
        e.time_left=.1
        _,last,done,_,_=e.step(ACTION_WAIT)
        self.assertTrue(done)
        self.assertAlmostEqual(reward+last,0)

    def test_npc_deadline_after_all_raw_collected(self):
        e = empty(); j = add_job(e, samples=1, npc_slot=0, leave_ms=100, leave_ms_total=100)
        e._interact_npc('npc_0')
        self.assertEqual(j.npc_slot, 0)
        e._advance(.2, None)
        self.assertTrue(j.npc_gone)
        self.assertEqual(j.npc_slot, -1)
        self.assertEqual(e.held, [])
        self.assertEqual(e._npc_slots_used, set())

    def test_setup_cancels_when_its_sample_leaves(self):
        e = empty(); add_job(e, npc_slot=0, leave_ms=100, leave_ms_total=100, unstarted=1)
        e.held = [HeldItem(0, 'prepped', 'wet', 0)]
        e.loc = 'bl0_hutch'; e._interact_hutch(e.loc)
        e._advance(.2, e.loc)
        self.assertEqual(e.exp_setup_bl, -1)
        self.assertIsNone(e.exp_setup_job)

    def test_partial_loss_prorates_original_reward(self):
        e = empty(); e.reputation = 100
        j = add_job(e, samples=3, rep=36, done=1, unstarted=2, npc_slot=0)
        e._npc_leaves(j)
        self.assertEqual(j.awarded, 12)
        self.assertEqual(e.reputation, 100)  # -12 loss, +12 earned
        self.assertEqual(e.summary()['proposals_full'], 0)
        self.assertEqual(e.summary()['proposals_partial'], 1)

    def test_departure_preserves_station_sample(self):
        e = empty(); j = add_job(e, unstarted=1, npc_slot=0)
        e.prep_wet = [PrepSlot(0, 1, 1)]
        e._npc_leaves(j)
        self.assertEqual(j.total_samples, 1)
        self.assertEqual(len(e.prep_wet), 1)

    def test_zero_loss_departure_does_not_penalize(self):
        e = empty(); e.reputation=100; j=add_job(e, npc_slot=0); j.unstarted=0
        e._npc_leaves(j)
        self.assertEqual(e.reputation,100)

    def test_cannot_arrive_after_or_at_deadline(self):
        for time in [.1, empty().travel_time('wet_prep','bl0_ctrl')]:
            e=empty(); add_job(e, samples=1, committed=False)
            e.meas_slots=[MeasSlot(0,0,0,1,True,True)]; e.time_left=time
            _, _, done, _, _ = e.step(LOC_IDX['bl0_ctrl'])
            self.assertTrue(done)
            self.assertEqual(e.reputation,0)
            self.assertEqual(e.loc,'wet_prep')

    def test_upgrade_keeps_deadline_and_reduces_work(self):
        a=FacilityEnv(config=BalanceConfig(rapid_review=False,beam_stops=False))
        b=FacilityEnv(config=a.config.changed(prep_speeds=(.5,.5),meas_speeds=(.5,)*4))
        a.reset(seed=10);b.reset(seed=10)
        for ja,jb in zip(a.jobs.values(),b.jobs.values()):
            self.assertEqual(ja.leave_ms_total,jb.leave_ms_total)
            self.assertLess(sum(jb.meas_durs),sum(ja.meas_durs))

    def test_unfinished_commitments_penalized_once(self):
        e=empty();j=add_job(e);e.reputation=20;e.time_left=.1
        e.step(ACTION_WAIT)
        self.assertEqual(e.reputation,12)
        e.step(ACTION_WAIT)
        self.assertEqual(e.reputation,12)

    def test_partial_commitment_no_cycle_penalty(self):
        e=empty();add_job(e,done=1);e.reputation=20;e._finish_cycle()
        self.assertEqual(e.reputation,20)

    def test_proximity_and_beam_stop(self):
        e=empty();add_job(e);e.prep_wet=[PrepSlot(0,2,2)]
        e.meas_slots=[MeasSlot(0,0,2,2,True)]
        e._advance(1,None)
        self.assertEqual(e.prep_wet[0].remaining,2)
        e.beam_start=0;e.beam_end=10
        e._advance(1,'bl0_ctrl')
        self.assertEqual(e.meas_slots[0].remaining,2)
        e._advance(1,'wet_prep')
        self.assertAlmostEqual(e.prep_wet[0].remaining,1)

    def test_postdoc_l3_collects_and_l1_requires_player(self):
        e=empty(postdoc_levels=(3,));j=add_job(e,samples=1)
        e.meas_slots=[MeasSlot(0,0,.5,.5,True)]
        e.postdocs[0].update(loc='bl0_ctrl',target='bl0_ctrl',eta=0)
        e._advance(1,None)
        self.assertTrue(j.completed)
        e=empty(postdoc_levels=(1,));add_job(e,samples=1)
        e.prep_wet=[PrepSlot(0,1,1)]
        e._advance(.5,None)
        self.assertEqual(e.prep_wet[0].remaining,1)
        e._advance(.5,'wet_prep')
        self.assertLess(e.prep_wet[0].remaining,1)

    def test_rapid_offers_and_generation_gating(self):
        e=empty(rapid_review=True,rapid_interval=1)
        e._advance(1.1,None)
        self.assertEqual(len(e.jobs),1)
        self.assertFalse(e.jobs[0].committed)
        self.assertEqual(len(applications(1)),4)
        self.assertGreater(len(applications(11)),len(applications(1)))

    def test_invalid_actions_and_configs(self):
        with self.assertRaises(ValueError):empty().step(-1)
        with self.assertRaises(ValueError):empty().step(1.5)
        for values in [dict(year=0),dict(n_jobs=1.2),dict(quantum=0),dict(ring_stability=101),
                       dict(prep_speeds=[1]),dict(beam_stops=1),dict(postdoc_levels=[4]),
                       dict(meas_min=20),dict(max_npc_waiting=6)]:
            with self.subTest(values=values),self.assertRaises(ValueError):BalanceConfig(**values)

    def test_reproducibility_and_conservation(self):
        c=BalanceConfig()
        a=run_cycle(c,5,events=True);b=run_cycle(c,5,events=True)
        self.assertEqual(a,b)
        self.assertAlmostEqual(a['travel_seconds']+a['wait_seconds'],c.cycle_seconds)
        self.assertEqual(a['reputation'],a['rep_earned']-a['penalties'])
        self.assertAlmostEqual(a['training_reward'],a['net_reputation'])
        for seed in range(10):
            e=FacilityEnv(config=c);e.reset(seed=seed)
            for _ in range(10000):
                obs,_,done,_,_=e.step(e.heuristic_action())
                self.assertTrue(e.observation_space.contains(obs))
                slots=[j.npc_slot for j in e.jobs.values() if j.npc_slot>=0]
                self.assertEqual(len(slots),len(set(slots)))
                for j in e.jobs.values():
                    in_flight=sum(h.job_id==j.job_id for h in e.held)+sum(p.job_id==j.job_id for p in e.prep_wet+e.prep_dry)+sum(m.job_id==j.job_id for m in e.meas_slots)
                    self.assertEqual(j.original_samples,j.done+j.lost_samples+j.unstarted+in_flight)
                if done:break
            else:self.fail('Environment did not terminate')


class CampaignTests(unittest.TestCase):
    def result(self,c,samples=0,net=0):
        return dict(config_hash=c.cycle_config().fingerprint,time_left=0,reputation=c.reputation+net,
                    net_reputation=net,samples_done=samples)

    def test_annual_order_carryover_salary_and_paper(self):
        c=Campaign.new(BalanceConfig(cycle=3,postdoc_levels=(1,)))
        c.reputation=100;c.funding=150000
        row=c.settle(self.result(c,samples=3,net=20),'paper')
        self.assertEqual(row['grant'],260000)
        self.assertEqual(row['salary'],100000)
        self.assertEqual(c.funding,260000)
        self.assertEqual(c.reputation,136)
        self.assertEqual((c.year,c.cycle),(2,4))

    def test_transaction_rolls_back_and_purchase_caps(self):
        c=Campaign.new(BalanceConfig());before=c.snapshot()
        with self.assertRaises(ValueError):c.settle(self.result(c),purchases=['hire','hire'])
        self.assertEqual(c.snapshot(),before)
        c.postdoc_levels=[1,1]
        with self.assertRaises(ValueError):c.purchase('hire',set())

    def test_debt_is_visible(self):
        c=Campaign.new(BalanceConfig(cycle=3,postdoc_salary=200000,postdoc_levels=(1,1)))
        c.funding=0
        row=c.settle(self.result(c))
        self.assertEqual(row['debt'],200000)
        with self.assertRaises(ValueError):c.purchase('prep_speed_0',set())

    def test_replayed_settlement_rejected(self):
        c=Campaign.new(BalanceConfig());result=self.result(c);c.settle(result)
        with self.assertRaises(ValueError):c.settle(result)

    def test_strategy_plan_valid_over_campaign(self):
        c=Campaign.new(BalanceConfig())
        for seed in range(9):
            result=run_cycle(c.cycle_config(),seed,reputation=c.reputation)
            action,purchases=automatic_plan(c,result,'balanced')
            c.settle(result,action,purchases)
        self.assertEqual(c.year,4)
        self.assertEqual(len(c.history),9)


class ExperimentTests(unittest.TestCase):
    def test_paired_reports_and_csv(self):
        c=BalanceConfig(cycle_seconds=10)
        a=simulate(c,[1,2]);b=simulate(c,[1,2])
        self.assertEqual(paired_difference(a,b)['mean'],0)
        with self.assertRaises(ValueError):paired_difference(a,simulate(c,[2,1]))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                write_report(Path(directory)/'test.csv',dict(variants={'a':a}))
            path=write_report(Path(directory)/'test.json',dict(variants={'a':a,'b':b}))
            self.assertTrue(path.with_suffix('.csv').exists())
            self.assertEqual(json.loads(path.read_text())['rules_version'],2)

    def test_browser_catalog_and_reward_contract(self):
        output=subprocess.check_output(['node',str(ROOT/'balance/browser_contract.js')],text=True)
        contract=json.loads(output)
        self.assertEqual(contract['catalog'],json.loads((ROOT/'balance/catalog.json').read_text()))
        self.assertEqual(contract['completion_reputation'],21)
        e=empty();add_job(e)
        for _ in range(2):
            e.meas_slots=[MeasSlot(0,0,0,1,True,True)];e._interact_ctrl('bl0_ctrl')
        self.assertEqual(e.reputation,contract['completion_reputation'])
        self.assertEqual(contract['cycle_seconds'],BalanceConfig().cycle_seconds)
        self.assertEqual(contract['durations'],[1,2,1,2,2,10])

    def test_campaign_cli_writes_both_formats(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'campaign.json'
            subprocess.check_output([sys.executable,str(ROOT/'rl/balance.py'),'campaign',
                                     '--years','1','--episodes','1','--output',str(output)])
            report=json.loads(output.read_text())
            self.assertEqual(len(report['campaigns'][0]['cycles']),3)
            header=output.with_suffix('.csv').read_text().splitlines()[0]
            self.assertIn('campaign_seed',header)


if __name__=='__main__':unittest.main()
