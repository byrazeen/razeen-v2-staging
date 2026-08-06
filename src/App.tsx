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
import Admin from "@/pages/Admin";
import AdminOrder from "@/pages/AdminOrder";
import ProductionQueue from "@/pages/ProductionQueue";
import Outbox from "@/pages/Outbox";

export default function App() {
  return (
    <CartProvider>
      {/* المعاينة تُقدَّم من مسار فرعي (‎/razeen-v2-staging/‎) على GitHub Pages،
          ومن الجذر محلياً. Vite يحقن المسار وقت البناء، فيعمل الاثنان بلا فرع. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
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
            {/* staging فقط: لوحة الإدارة خلف دخول وهمي، وصندوق الصادر مفتوح للمراجعة */}
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/orders/:orderNumber" element={<AdminOrder />} />
            <Route path="/admin/queue" element={<ProductionQueue />} />
            <Route path="/outbox" element={<Outbox />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </CartProvider>
  );
}
