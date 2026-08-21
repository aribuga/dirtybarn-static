export interface PriceDisplay {
  active: string | null;
  regular: string | null;
  hasDiscount: boolean;
}

function parsePrice(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formatValue(value: number, currency: string): string {
  if (!currency.trim()) return String(value);
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value} ${currency.toUpperCase()}`;
  }
}

export function formatProductPrice(
  price: string,
  regularPrice: string,
  currency: string,
): PriceDisplay {
  const activeValue = parsePrice(price);
  const regularValue = parsePrice(regularPrice);
  if (activeValue === null) return { active: null, regular: null, hasDiscount: false };

  const hasDiscount = regularValue !== null && regularValue > activeValue;
  return {
    active: formatValue(activeValue, currency),
    regular: hasDiscount && regularValue !== null ? formatValue(regularValue, currency) : null,
    hasDiscount,
  };
}
