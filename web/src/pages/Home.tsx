import { Link } from 'react-router-dom';
import { useOverview } from '../api/queries';
import type { Overview } from '../api/types';
import { Avatar, Empty, ErrorState, Icon, Loading, Meter } from '../components/ui';
import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, countWord, plural, relTime } from '../lib/format';
import { usePageTitle, useTick } from '../lib/hooks';

function headline(n: number): string {
  if (n === 0) return 'Nothing to review right now';
  if (n === 1) return 'One proposal is ready to review';
  return `${countWord(n)} proposals are ready to review`;
}

function subline(o: Overview): string {
  const active = o.appliers.filter((a) => a.active).length;
  const who = active === 1 ? 'Your applier' : `Your ${countWord(active).toLowerCase()} appliers`;
  const checked = `checked ${plural(o.jobsCheckedLast24h, 'new job')} since yesterday`;
  if (active === 0) return 'All your appliers are paused. Turn one on in Appliers to start finding jobs.';
  if (o.pendingDrafts === 0) return `${who} ${checked}. New drafts appear here when a job scores well.`;
  const best = o.pendingDrafts === 1 ? 'drafted a reply for the best one' : `drafted replies for the best ${countWord(o.pendingDrafts).toLowerCase()}`;
  return `${who} ${checked} and ${best}.`;
}

function AccountBanners({ accounts }: { accounts: Overview['accounts'] }) {
  const flagged = accounts.filter((a) => a.status === 'sample' || a.status === 'error');
  if (flagged.length === 0) return null;
  return (
    <>
      {flagged.map((a) => (
        <div key={a.id} className={a.status === 'error' ? 'banner banner-err' : 'banner'} role="status">
          <Icon.Warn />
          <div style={{ flex: '1 1 320px' }}>
            {a.status === 'sample' ? (
              <>
                <strong>{a.name}'s Upwork account is using sample jobs.</strong> The API key is still waiting for Upwork's
                approval, so its appliers can't see real jobs yet.
              </>
            ) : (
              <>
                <strong>{a.name}'s Upwork account couldn't search for jobs.</strong> Check the keys in Settings so its
                appliers can run again.
              </>
            )}
          </div>
          <Link className="btn btn-s" to="/settings#accounts">
            Check accounts
          </Link>
        </div>
      ))}
    </>
  );
}

function SetupEmpty({ o }: { o: Overview }) {
  const missing = !o.setup.hasAccount ? 'an Upwork account' : 'an applier';
  return (
    <>
      <div className="top">
        <div>
          <h1 className="h1">Let's find your first good jobs</h1>
          <p className="sub">
            You haven't added {missing} yet. The setup guide takes about ten minutes, and you can start with sample jobs while
            Upwork reviews your API key.
          </p>
        </div>
        <Link className="btn btn-p" to="/setup">
          Open the setup guide
        </Link>
      </div>
      <Empty title="Nothing to show yet">
        <p className="mut" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
          Once an applier is running, drafts waiting for you, this week's proposals and your appliers show up here.
        </p>
        <Link className="btn" to="/setup">
          Go to setup
        </Link>
      </Empty>
    </>
  );
}

function Week({ week }: { week: Overview['week'] }) {
  const total = STATUS_ORDER.reduce((s, k) => s + (week.byStatus[k] ?? 0), 0);
  const replies = (['replied', 'interview', 'hired'] as const).reduce((s, k) => s + (week.byStatus[k] ?? 0), 0);
  const shown = STATUS_ORDER.filter((k) => (week.byStatus[k] ?? 0) > 0);
  const ariaLabel =
    total === 0
      ? 'No proposals this week'
      : `Of ${total} proposals: ` + shown.map((k) => `${week.byStatus[k]} ${STATUS_LABEL[k].toLowerCase()}`).join(', ');
  return (
    <section className="panel" aria-labelledby="h-week">
      <div className="ph">
        <h2 className="h2 h2-sm" id="h-week">This week</h2>
        <Link to="/applied">Applied jobs</Link>
      </div>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ font: "700 44px/1 'Bricolage Grotesque', sans-serif" }}>{week.sent}</span>
          <span className="mut" style={{ fontSize: 15 }}>
            {week.sent === 1 ? 'proposal sent' : 'proposals sent'}
            {week.sent > 0 && `, ${plural(replies, 'reply', 'replies')} so far`}
          </span>
        </div>
        <div>
          <div className="bar" role="img" aria-label={ariaLabel}>
            {total > 0 &&
              shown.map((k) => (
                <span key={k} style={{ width: `${((week.byStatus[k] ?? 0) / total) * 100}%`, background: STATUS_COLOR[k] }} />
              ))}
          </div>
          {shown.length > 0 ? (
            <div className="legend">
              {shown.map((k) => (
                <span key={k}>
                  <i style={{ background: STATUS_COLOR[k] }} />
                  {week.byStatus[k]} {k === 'applied' ? 'no reply yet' : STATUS_LABEL[k].toLowerCase()}
                </span>
              ))}
            </div>
          ) : (
            <p className="mut" style={{ margin: '12px 0 0', fontSize: 13 }}>
              Proposals you mark as submitted show up here.
            </p>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid #E4EAE8', fontSize: 14 }}>
          <span className="mut">Connects spent</span>
          <strong>{week.connects}</strong>
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  usePageTitle('Home');
  useTick();
  const q = useOverview();

  if (q.isPending) return <Loading label="Loading your overview" />;
  if (q.isError) return <ErrorState what="your overview" error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;

  if (!o.setup.hasAccount || !o.setup.hasApplier) {
    return (
      <>
        <AccountBanners accounts={o.accounts} />
        <SetupEmpty o={o} />
      </>
    );
  }

  const n = o.pendingDrafts;
  return (
    <>
      <div className="top">
        <div>
          <h1 className="h1">{headline(n)}</h1>
          <p className="sub">{subline(o)}</p>
        </div>
        {n > 0 && (
          <Link className="btn btn-p" to="/review">
            Start reviewing
          </Link>
        )}
      </div>

      <AccountBanners accounts={o.accounts} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <section className="panel" style={{ flex: '2 1 520px', minWidth: 0 }} aria-labelledby="h-wait">
          <div className="ph">
            <h2 className="h2 h2-sm" id="h-wait">Waiting for you</h2>
            {n > 0 && <Link to="/review">{n === 1 ? 'See it' : `See all ${countWord(n).toLowerCase()}`}</Link>}
          </div>
          {o.topDrafts.length === 0 ? (
            <div className="state-box">
              That's everything for now. New drafts appear here as your appliers find good matches.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {o.topDrafts.map((d) => (
                <li key={d.id} className="wait-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} role="img" aria-label={`Fit ${d.score} out of 100`}>
                    <span className="fitn">{d.score}</span>
                    <Meter score={d.score} />
                  </div>
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <Link to={`/review?draft=${encodeURIComponent(d.id)}`} style={{ fontWeight: 600, fontSize: 15, textDecoration: 'none' }}>
                      {d.title}
                    </Link>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 6, fontSize: 13, color: '#47605B' }}>
                      <span className="acct">
                        <Avatar id={d.account.id} name={d.account.name} />
                        <span className="sr-only">{d.account.name}, </span>
                        {d.applier.name}
                      </span>
                      {d.budgetLabel && <span>{d.budgetLabel}</span>}
                      {d.postedAt && <span>Posted {relTime(d.postedAt)}</span>}
                    </div>
                  </div>
                  <Link className="btn btn-s" to={`/review?draft=${encodeURIComponent(d.id)}`} aria-label={`Review ${d.title}`}>
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Week week={o.week} />

          <section className="panel" aria-labelledby="h-appliers">
            <div className="ph">
              <h2 className="h2 h2-sm" id="h-appliers">Appliers</h2>
              <Link to="/appliers">Manage</Link>
            </div>
            {o.appliers.length === 0 ? (
              <div className="state-box">
                No appliers yet. <Link to="/appliers/new">Create one</Link>.
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: '8px 0' }}>
                {o.appliers.map((a) => (
                  <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px' }}>
                    <span
                      aria-hidden="true"
                      style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: a.active ? '#2E9A62' : '#B7C5C1' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                        <Link to={`/appliers/${a.id}`} style={{ textDecoration: 'none' }}>
                          {a.name}
                        </Link>
                      </div>
                      <div className="mut" style={{ fontSize: 13, marginTop: 2 }}>
                        {a.active
                          ? `${a.lastRunAt ? 'Checked ' + relTime(a.lastRunAt) : 'Not checked yet'}, ${plural(a.pendingDrafts, 'draft')}`
                          : 'Paused'}
                      </div>
                    </div>
                    <span className="acct">
                      <Avatar id={a.account.id} name={a.account.name} />
                      <span className="sr-only">{a.account.name}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
