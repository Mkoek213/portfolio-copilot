import type { AssetClass } from "./types";

export type SampleAccount = {
  key: string;
  provider: "BINANCE" | "XTB" | "BANK" | "MANUAL";
  name: string;
  baseCurrency: string;
};

export type SampleAsset = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  sector?: string;
};

export type SamplePosition = {
  accountKey: string;
  symbol: string;
  quantity: number;
  marketPrice: number;
  marketValueBase: number;
  currency: string;
};

export const sampleAccounts: SampleAccount[] = [
  { key: "bank-pln", provider: "BANK", name: "Bank PLN cash", baseCurrency: "PLN" },
  { key: "xtb-main", provider: "XTB", name: "XTB read-only sample", baseCurrency: "PLN" },
  { key: "binance-main", provider: "BINANCE", name: "Binance read-only sample", baseCurrency: "PLN" }
];

export const sampleAssets: SampleAsset[] = [
  { symbol: "PLN", name: "Polish Zloty", assetClass: "CASH", currency: "PLN" },
  { symbol: "VWCE.DE", name: "Vanguard FTSE All-World UCITS ETF", assetClass: "ETF_STOCK", currency: "EUR", sector: "Global equity" },
  { symbol: "EIMI.L", name: "iShares Core MSCI EM IMI ETF", assetClass: "ETF_STOCK", currency: "USD", sector: "Emerging markets" },
  { symbol: "TBSP.PL", name: "Polish Treasury Bond ETF", assetClass: "BOND", currency: "PLN", sector: "Government bonds" },
  { symbol: "BTC", name: "Bitcoin", assetClass: "CRYPTO", currency: "USD", sector: "Crypto" },
  { symbol: "ETH", name: "Ethereum", assetClass: "CRYPTO", currency: "USD", sector: "Crypto" },
  { symbol: "GLD", name: "Gold exposure sample", assetClass: "COMMODITY", currency: "USD", sector: "Precious metals" }
];

export const samplePositions: SamplePosition[] = [
  { accountKey: "bank-pln", symbol: "PLN", quantity: 18500, marketPrice: 1, marketValueBase: 18500, currency: "PLN" },
  { accountKey: "xtb-main", symbol: "VWCE.DE", quantity: 42, marketPrice: 520, marketValueBase: 21840, currency: "EUR" },
  { accountKey: "xtb-main", symbol: "EIMI.L", quantity: 220, marketPrice: 135, marketValueBase: 29700, currency: "USD" },
  { accountKey: "xtb-main", symbol: "TBSP.PL", quantity: 95, marketPrice: 210, marketValueBase: 19950, currency: "PLN" },
  { accountKey: "binance-main", symbol: "BTC", quantity: 0.18, marketPrice: 255000, marketValueBase: 45900, currency: "USD" },
  { accountKey: "binance-main", symbol: "ETH", quantity: 2.4, marketPrice: 14200, marketValueBase: 34080, currency: "USD" },
  { accountKey: "xtb-main", symbol: "GLD", quantity: 30, marketPrice: 390, marketValueBase: 11700, currency: "USD" }
];
