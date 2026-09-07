export const PUBLICATION_JOBS = {
  news: { interval:120*60_000, grace:35*60_000, file:"edition-state.json", timestamp:"lastPublishedAt" },
  telegram: { interval:60*60_000, grace:15*60_000, file:"telegram/state.json", timestamp:"lastSentAt" },
  "telegram-ru": { interval:60*60_000, grace:20*60_000, file:"telegram-ru/state.json", timestamp:"lastSentAt" },
  x: { interval:60*60_000, grace:15*60_000, file:"x/state.json", timestamp:"lastSentAt" },
} as const;
export type PublicationJob = keyof typeof PUBLICATION_JOBS;
export interface PublicationHealth { job:PublicationJob; lastPublication:number; pending:boolean; timerActive:boolean; serviceRunning:boolean; pausedUntil?:number; }
export interface PublicationAction { job:PublicationJob; action:"enable-timer"|"start-service"; }
export function publicationHealthPlan(snapshots:PublicationHealth[],now=Date.now()) {
  const actions:PublicationAction[]=[];
  const incidents:{job:PublicationJob;reason:string}[]=[];
  for(const row of snapshots) {
    if(row.pausedUntil && row.pausedUntil>now)continue;
    const config=PUBLICATION_JOBS[row.job];
    if(row.pending) { incidents.push({job:row.job,reason:"Unknown send outcome requires receipt reconciliation; automatic resending is blocked."});continue; }
    if(!row.timerActive)actions.push({job:row.job,action:"enable-timer"});
    if(!Number.isFinite(row.lastPublication)||now-row.lastPublication>config.interval+config.grace) {
      incidents.push({job:row.job,reason:"Publication is overdue."});
      if(!row.serviceRunning)actions.push({job:row.job,action:"start-service"});
    }
  }
  return {actions,incidents};
}
