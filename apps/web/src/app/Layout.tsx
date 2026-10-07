import { Link, NavLink, Outlet } from 'react-router-dom';
import { useSealContext } from '../data/SealApiProvider';
import { CLUSTERS, type Cluster } from '../lib/cluster';
import { useTheme, type ThemePreference } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { WalletMenu } from '../wallet/WalletMenu';
import styles from './Layout.module.css';

export function Layout() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true" />
            Seal
            <span className={styles.tagline}>audit attestations pinned to a deploy slot</span>
          </Link>
          <nav className={styles.nav} aria-label="Main">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
            >
              Lookup
            </NavLink>
            <NavLink
              to="/issue"
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
            >
              Issue
            </NavLink>
            <WalletMenu />
          </nav>
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}

function Footer() {
  const { cluster, config, setCluster, demo } = useSealContext();
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span className={styles.footerGroup}>
          <label htmlFor="cluster">Cluster</label>
          <select
            id="cluster"
            className={styles.select}
            value={cluster}
            onChange={(event) => setCluster(event.target.value as Cluster)}
          >
            {CLUSTERS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <span className={styles.endpoint} title={config.rpcUrl}>
            {config.rpcUrl.replace(/^https?:\/\//, '')}
          </span>
        </span>

        {demo ? (
          <span className={styles.demo}>
            <Icon name="triangle-alert" size={12} />
            Demo data
          </span>
        ) : null}

        <span className={styles.footerSpacer} />
        <ThemeToggle />
      </div>
    </footer>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: 'sun' | 'moon' | null }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: null },
];

function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <div className={styles.themeToggle} role="group" aria-label="Theme">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`${styles.themeOption} ${preference === option.value ? styles.themeOptionActive : ''}`}
          aria-pressed={preference === option.value}
          onClick={() => setPreference(option.value)}
        >
          {option.icon ? <Icon name={option.icon} size={12} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}
