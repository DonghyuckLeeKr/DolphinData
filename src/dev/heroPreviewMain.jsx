// Dev-only entry for hero-preview.html.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import '../index.css';
import HeroPreview from './HeroPreview';

createRoot(document.getElementById('root')).render(<StrictMode><HeroPreview /></StrictMode>);
