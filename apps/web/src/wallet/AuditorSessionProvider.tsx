import { useWalletAccountTransactionSendingSigner } from '@solana/react';
import type { UiWalletAccount } from '@wallet-standard/react';
import type { Address, TransactionSendingSigner } from '@solana/kit';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuditorSession } from '../data/types';
import { useSealContext } from '../data/SealApiProvider';
import { DEMO_AUDITOR } from '../demo/fixtures';

type ConnectedIdentity =
  | { mode: 'wallet'; account: UiWalletAccount }
  | { mode: 'demo'; authority: Address; label: string };

type AuditorSessionContextValue = {
  /** Null until an auditor connects. Browsing never needs one. */
  session: AuditorSession | null;
  label: string | null;
  identity: ConnectedIdentity | null;
  selectAccount: (account: UiWalletAccount) => void;
  connectDemoAuditor: () => void;
  disconnect: () => void;
};

const AuditorSessionContext = createContext<AuditorSessionContextValue | null>(null);

export function AuditorSessionProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<ConnectedIdentity | null>(null);
  const [signer, setSigner] = useState<TransactionSendingSigner | null>(null);

  const value = useMemo<AuditorSessionContextValue>(() => {
    const session: AuditorSession | null =
      identity === null
        ? null
        : identity.mode === 'demo'
          ? { authority: identity.authority, signer: null }
          : { authority: identity.account.address as Address, signer };
    return {
      session,
      label: identity === null ? null : identity.mode === 'demo' ? identity.label : identity.account.label ?? null,
      identity,
      selectAccount: (account) => setIdentity({ mode: 'wallet', account }),
      connectDemoAuditor: () =>
        setIdentity({ mode: 'demo', authority: DEMO_AUDITOR.authority, label: DEMO_AUDITOR.name }),
      disconnect: () => {
        setIdentity(null);
        setSigner(null);
      },
    };
  }, [identity, signer]);

  return (
    <AuditorSessionContext.Provider value={value}>
      {identity?.mode === 'wallet' ? <SignerBridge account={identity.account} onSigner={setSigner} /> : null}
      {children}
    </AuditorSessionContext.Provider>
  );
}

/**
 * `useWalletAccountTransactionSendingSigner` is a hook, so it cannot be called conditionally from
 * the provider. This component exists only while an account is selected and publishes the signer up.
 */
function SignerBridge({
  account,
  onSigner,
}: {
  account: UiWalletAccount;
  onSigner: (signer: TransactionSendingSigner | null) => void;
}) {
  const { config } = useSealContext();
  const signer = useWalletAccountTransactionSendingSigner(account, config.chain);
  useEffect(() => {
    onSigner(signer);
    return () => onSigner(null);
  }, [signer, onSigner]);
  return null;
}

export function useAuditorSession(): AuditorSessionContextValue {
  const context = useContext(AuditorSessionContext);
  if (!context) throw new Error('useAuditorSession must be used inside <AuditorSessionProvider>');
  return context;
}
