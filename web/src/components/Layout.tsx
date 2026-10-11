import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useOverview } from '../api/queries';
import { Icon } from './ui';

const NAV = [
  { to: '/', label: 'Home', tab: 'Home', icon: Icon.Home, end: true },
  { to: '/review', label: 'Review drafts', tab: 'Review', icon: Icon.Inbox, badge: true },
  { to: '/appliers', label: 'Appliers', tab: 'Appliers', icon: Icon.Sliders },
  { to: '/applied', label: 'Applied jobs', tab: 'Applied', icon: Icon.Applied },
  { to: '/settings', label: 'Settings', tab: 'Settings', icon: Icon.Settings },
];
// Bottom tab bar order follows MobileApplied.dc.html, with Settings added at the end.
const TAB_ORDER = ['/', '/review', '/applied', '/appliers', '/settings'];

export function Layout() {
  const { data } = useOverview();
  const pending = data?.pendingDrafts ?? 0;
  const loc = useLocation();
  const reviewingOnPhone = loc.pathname === '/review' && new URLSearchParams(loc.search).has('draft');

  return (
    <div className={'app' + (reviewingOnPhone ? ' review-hides-tabbar' : '')}>
      <a href="#main" className="sr-only skip">
        Skip to content
      </a>
      <aside className="side">
        <NavLink to="/" className="brand" aria-label="Job Assistant, home">
          <span className="mark">
            <Icon.Check size={18} />
          </span>
          Job Assistant
        </NavLink>
        <nav aria-label="Main" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'nl on' : 'nl')}>
              <n.icon />
              {n.label}
              {n.badge && pending > 0 && (
                <span className="nb">
                  {pending}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidefoot">You review every draft and submit it yourself on Upwork. Nothing is sent for you.</div>
      </aside>

      <main className="main" id="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main">
        {TAB_ORDER.map((to) => {
          const n = NAV.find((x) => x.to === to)!;
          return (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'tab on' : 'tab')}>
              <n.icon size={22} />
              {n.tab}
              {n.badge && pending > 0 && (
                <span className="tb">
                  {pending}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
