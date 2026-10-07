import { useConnect, useWallets, type UiWallet } from '@wallet-standard/react';
import { useSealContext } from '../data/SealApiProvider';
import { truncateAddress } from '../lib/format';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useAuditorSession } from './AuditorSessionProvider';
import styles from './WalletMenu.module.css';

/** Only auditors need a wallet, so this never blocks or interrupts browsing. */
export function WalletMenu() {
  const { demo } = useSealContext();
  const { session, label, disconnect, connectDemoAuditor } = useAuditorSession();

  if (session) {
    return (
      <div className={styles.connected}>
        <span className={styles.identity}>
          <Icon name="wallet" size={14} />
          <span className={styles.label}>{label ?? 'Auditor'}</span>
          <span className={`${styles.address} mono`}>{truncateAddress(session.authority)}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    );
  }

  if (demo) {
    return (
      <Button size="sm" onClick={connectDemoAuditor}>
        <Icon name="wallet" size={14} />
        Connect demo auditor
      </Button>
    );
  }

  return <WalletPicker />;
}

function WalletPicker() {
  const wallets = useWallets().filter((wallet) => wallet.chains.some((chain) => chain.startsWith('solana:')));

  if (wallets.length === 0) {
    return (
      <span className={styles.none}>
        No Solana wallet detected
      </span>
    );
  }

  return (
    <details className={styles.menu}>
      <summary className={styles.summary}>
        <Icon name="wallet" size={14} />
        Connect wallet
      </summary>
      <ul className={styles.list}>
        {wallets.map((wallet) => (
          <li key={wallet.name}>
            <WalletOption wallet={wallet} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function WalletOption({ wallet }: { wallet: UiWallet }) {
  const { selectAccount } = useAuditorSession();
  const [isConnecting, connect] = useConnect(wallet);

  return (
    <button
      type="button"
      className={styles.option}
      disabled={isConnecting}
      onClick={async () => {
        const accounts = wallet.accounts.length > 0 ? wallet.accounts : await connect();
        const [account] = accounts;
        if (account) selectAccount(account);
      }}
    >
      {wallet.icon ? <img src={wallet.icon} alt="" className={styles.icon} width={16} height={16} /> : null}
      {wallet.name}
      {isConnecting ? <span className={styles.connecting}>connecting…</span> : null}
    </button>
  );
}
