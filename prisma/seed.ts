import { PrismaClient } from "@prisma/client";
import { sampleAccounts, sampleAssets, samplePositions } from "../src/domain/portfolio/sample-data";
import { defaultStrategy, financialProfileCreateInput, strategySettingsCreateInput } from "../src/domain/portfolio/strategy";

const prisma = new PrismaClient();

async function main() {
  const accountIds = new Map<string, string>();

  await prisma.strategySettings.upsert({
    where: { resourceId: defaultStrategy.resourceId },
    update: strategySettingsCreateInput(defaultStrategy),
    create: strategySettingsCreateInput(defaultStrategy)
  });

  await prisma.userFinancialProfile.upsert({
    where: { resourceId: defaultStrategy.resourceId },
    update: financialProfileCreateInput(defaultStrategy),
    create: financialProfileCreateInput(defaultStrategy)
  });

  for (const account of sampleAccounts) {
    const created = await prisma.account.upsert({
      where: { id: account.key },
      update: {
        provider: account.provider,
        name: account.name,
        baseCurrency: account.baseCurrency,
        readOnly: true
      },
      create: {
        id: account.key,
        provider: account.provider,
        name: account.name,
        baseCurrency: account.baseCurrency,
        readOnly: true
      }
    });

    accountIds.set(account.key, created.id);
  }

  for (const asset of sampleAssets) {
    await prisma.asset.upsert({
      where: { symbol: asset.symbol },
      update: asset,
      create: asset
    });
  }

  await prisma.position.deleteMany();

  const assets = await prisma.asset.findMany();
  const assetIds = new Map(assets.map((asset) => [asset.symbol, asset.id]));
  const asOf = new Date();

  for (const position of samplePositions) {
    const accountId = accountIds.get(position.accountKey);
    const assetId = assetIds.get(position.symbol);

    if (!accountId || !assetId) {
      throw new Error(`Missing account or asset for ${position.symbol}`);
    }

    await prisma.position.create({
      data: {
        accountId,
        assetId,
        quantity: position.quantity,
        marketPrice: position.marketPrice,
        marketValueBase: position.marketValueBase,
        currency: position.currency,
        asOf
      }
    });
  }

  console.log(
    `Seeded strategy, financial profile, ${sampleAccounts.length} accounts, ${sampleAssets.length} assets and ${samplePositions.length} positions.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
