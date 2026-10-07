import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  type GetAccountInfoApi,
  type GetLatestBlockhashApi,
  type GetProgramAccountsApi,
  type Rpc,
  type RpcSubscriptions,
  type AccountNotificationsApi,
  type SimulateTransactionApi,
} from '@solana/kit';
import type { ClusterConfig } from '../lib/cluster';

/** Exactly the RPC methods this app uses, so a mock only has to implement these. */
export type SealRpc = Rpc<
  GetAccountInfoApi & GetProgramAccountsApi & GetLatestBlockhashApi & SimulateTransactionApi
>;

export type SealRpcSubscriptions = RpcSubscriptions<AccountNotificationsApi>;

export function createRpcClients(config: ClusterConfig): {
  rpc: SealRpc;
  rpcSubscriptions: SealRpcSubscriptions;
} {
  return {
    rpc: createSolanaRpc(config.rpcUrl),
    rpcSubscriptions: createSolanaRpcSubscriptions(config.rpcWsUrl),
  };
}
