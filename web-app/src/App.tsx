import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import Overview from "./pages/Overview";
import Report from "./pages/Report";
import Categories from "./pages/Categories";
import CategoryDetail from "./pages/CategoryDetail";
import TaskDetail from "./pages/TaskDetail";
import Models from "./pages/Models";
import ModelDetail from "./pages/ModelDetail";
import Spec from "./pages/Spec";
import DesignReview from "./pages/DesignReview";
import MedicalReview from "./pages/MedicalReview";
import NotFound from "./pages/NotFound";
import { ScrollToTop } from "./components/ScrollToTop";

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="report" element={<Report />} />
          <Route path="categories" element={<Categories />} />
          <Route path="categories/:id" element={<CategoryDetail />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="models" element={<Models />} />
          <Route path="models/:id" element={<ModelDetail />} />
          <Route path="spec" element={<Spec />} />
          <Route path="design-review" element={<DesignReview />} />
          <Route path="medical-review" element={<MedicalReview />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
