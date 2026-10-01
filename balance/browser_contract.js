// Read-only contract probe: execute selected actual browser rules without Phaser/UI/network.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const context = {window:{innerWidth:960,innerHeight:600,devicePixelRatio:1},Math};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'js/data.js'),'utf8') + `
this.contract = {
 catalog: GENERATION_DATA.map(g=>({generation:g.gen,start_year:g.startYear,name:g.name,techniques:g.techs,
 applications:g.apps.map(a=>({name:a.name,min_samples:a.samples[0],max_samples:a.samples[1],base_rep:a.rep,lab:a.lab}))})),
 cycle_seconds:CYCLE_SEC,
 durations:[DUR_PREP_MIN,DUR_PREP_MAX,DUR_EXP_SETUP_MIN,DUR_EXP_SETUP_MAX,DUR_MEAS_MIN,DUR_MEAS_MAX]
};`,context);
const source=fs.readFileSync(path.join(root,'js/game.js'),'utf8');
function method(name) {
 const start=source.indexOf('  '+name+'(');
 if(start<0) throw new Error('Missing browser method: '+name);
 const brace=source.indexOf('{',start);let depth=1,i=brace+1;
 while(depth && i<source.length){if(source[i]==='{')depth++;if(source[i]==='}')depth--;i++;}
 if(depth) throw new Error('Unbalanced method: '+name);
 return new Function('return ({'+source.slice(start,i)+'})')()[name];
}
const game={measSlots:[],active:[{id:0,name:'test',tech:'test',labType:'wet',totalSamples:2,done:0,rep:21,npcSlot:0}],
 reputation:0,totalSamples:0,yearSamples:0,sampTxt:{setText(){}},repTxt:{setText(){}},sampleLog:[],proposalLog:[],
 beamlineTechs:['test'],cycleStartWall:Date.now(),cycleProposalsDone:0,cycleRepEarned:0,
 redrawBeam(){},flash(){},_releaseNpcSlot(){},restockProposalHub(){},refreshJobs(){},refreshNPCs(){}};
for(let i=0;i<2;i++){
 game.measSlots.push({jobId:0,blIdx:0,toStage:'meas_ready'});
 method('_collectMeasResult').call(game,0);
}
context.contract.completion_reputation=game.reputation;
process.stdout.write(JSON.stringify(context.contract));
