import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PackExperience } from "./index";
import "./demo.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PackExperience
      packFront="/pack-front.svg"
      packBack="/pack-back.svg"
      card={{ image: "/card.svg", alt: "Grey mystery card with a question mark" }}
    />
  </StrictMode>,
);
