import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { CartProvider } from "@/lib/cart";
import Home from "@/pages/Home";
import Search from "@/pages/Search";
import Ready from "@/pages/Ready";
import Product from "@/pages/Product";
import CustomPerfume from "@/pages/CustomPerfume";
import Discover from "@/pages/Discover";
import Cart from "@/pages/Cart";
import Checkout from "@/pages/Checkout";
import Account from "@/pages/Account";

export default function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/ready" element={<Ready />} />
            <Route path="/product/:handle" element={<Product />} />
            <Route path="/custom" element={<CustomPerfume />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/account" element={<Account />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </CartProvider>
  );
}
