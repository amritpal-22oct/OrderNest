"use client";

import { useEffect } from "react";

// Payment is confirmed server-side before this page ever renders a success
// state, so it's safe to clear the local cart here.
export function ClearCart({ slug }: { slug: string }) {
  useEffect(() => {
    window.localStorage.removeItem(`ordernest_cart_${slug}`);
  }, [slug]);

  return null;
}
