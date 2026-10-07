import { getSealRegistryErrorMessage, isSealRegistryError, type SealRegistryError } from '@seal/client';
import { SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, isSolanaError, type Address } from '@solana/kit';

/**
 * A `seal_registry` error, decoded from the custom program error code with the generated message
 * table. Thrown by the write paths, which know the transaction they built and can therefore prove
 * the failing instruction was Seal's.
 */
export class SealProgramError extends Error {
  readonly code: SealRegistryError;

  constructor(code: SealRegistryError, options?: { cause?: unknown }) {
    super(getSealRegistryErrorMessage(code), options);
    this.name = 'SealProgramError';
    this.code = code;
  }
}

/** Rethrows a Seal program error as a decoded one; anything else is passed through untouched. */
export function decorateProgramError(
  error: unknown,
  transactionMessage: { instructions: Record<number, { programAddress: Address }> },
): unknown {
  if (isSealRegistryError(error, transactionMessage)) {
    return new SealProgramError(error.context.code as SealRegistryError, { cause: error });
  }
  return error;
}

export type DescribedError = {
  /** One sentence a reader can act on. */
  message: string;
  /** The verbatim machine text, shown beneath it so nothing is hidden. */
  detail: string | null;
};

/** What to show the user when a call fails: the real error, decoded as far as it can be. */
export function describeError(error: unknown): DescribedError {
  if (error instanceof SealProgramError) {
    return {
      message: error.message,
      detail: `seal_registry custom error ${error.code} (0x${error.code.toString(16)})`,
    };
  }
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
    const { code, index } = error.context;
    return {
      message: `A program returned custom error ${code}.`,
      detail: `instruction ${index} failed with custom error ${code} (0x${code.toString(16)})`,
    };
  }
  if (isSolanaError(error)) {
    return { message: error.message, detail: `${error.context.__code}` };
  }
  if (error instanceof Error) {
    return { message: error.message, detail: error.cause ? String(error.cause) : null };
  }
  return { message: 'Something failed and gave no message.', detail: String(error) };
}
