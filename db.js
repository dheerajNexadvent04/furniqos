// db.js - Database Manager (Local fallback + Supabase integration)
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// On serverless hosts (Vercel) the project folder is read-only, so local data lives in /tmp.
// /tmp is temporary there: Supabase is the permanent store for leads in production.
const BUNDLED_DATA_DIR = path.join(__dirname, 'data');
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = IS_SERVERLESS ? path.join('/tmp', 'furniqos-data') : BUNDLED_DATA_DIR;

const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');

// Never let a file-system error crash the server
function safeWrite(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.warn(`Could not write ${file}: ${e.message}`);
    return false;
  }
}

try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // Seed the writable copy of the CRM content from the version committed to the repo
  const bundledContent = path.join(BUNDLED_DATA_DIR, 'content.json');
  if (IS_SERVERLESS && !fs.existsSync(CONTENT_FILE) && fs.existsSync(bundledContent)) {
    fs.copyFileSync(bundledContent, CONTENT_FILE);
  }
} catch (e) {
  console.warn('Local data folder unavailable:', e.message);
}

// Initialize local files if not existing
if (!fs.existsSync(LEADS_FILE)) {
  safeWrite(LEADS_FILE, []);
}

// Default content seeded from Figma designs
const DEFAULT_CONTENT = {
  hero: {
    tickerText: "LUXURY FURNITURE SOURCING • PREMIUM CHINA MANUFACTURERS",
    rating: "4.9/5",
    verifiedText: "Build on 220+ Verified Experiences",
    categories: [
      { id: "residential", label: "Residential Furniture", active: true },
      { id: "commercial", label: "Commercial Furniture", active: false },
      { id: "wardrobes", label: "Wardrobes", active: false },
      { id: "artefacts", label: "Artefacts & Décor", active: false }
    ],
    desktopImage: "/assets/images/hero_full_background.jpg",
    mobileImage: "/assets/images/hero_full_background.jpg"
  },
  solutions: {
    title: "Complete Solutions for Every Space",
    subtitle: "Furniture, kitchens, wardrobes, lighting and décor, thoughtfully sourced for refined residential and commercial spaces."
  },
  showcase: [
    { title: "Living Room", image: "/assets/images/35_image_38_f8331a4e.jpg", tag: "Refined Luxury" },
    { title: "Bedroom", image: "/assets/images/36_image_42_0924bc86.jpg", tag: "Private Sanctuaries" },
    { title: "Dining Room", image: "/assets/images/37_image_40_f537c095.jpg", tag: "Artisanal Elegance" },
    { title: "Office", image: "/assets/images/38_image_39_d596c42e.jpg", tag: "Executive Spaces" },
    { title: "Home Decor", image: "/assets/images/39_image_43_1451e23f.jpg", tag: "Curated Accents" }
  ],
  whyFurniqos: {
    title: "Why Furniqos",
    text: "From premium furniture to complete interior solutions, every detail is carefully sourced and coordinated. One accountable partner, from design intent to final installation.",
    bgImage: "/assets/images/why_furniqos_bg.jpg"
  },
  about: {
    label: "About us",
    title: "Sourcing the Extraordinary",
    desc1: "FURNIQOS brings together premium Italian furniture design, global sourcing and seamless execution for refined residential and commercial spaces.",
    desc2: "From furniture and upholstery to kitchens, wardrobes and curated artefacts, every element is carefully sourced and coordinated to create spaces that feel distinctive, considered and complete.",
    image: "/assets/images/about_showcase_arch.jpg"
  },
  cta: {
    tag: "LET'S CONNECT",
    title: "Let’s Create Something Exceptional",
    subtitle: "Tell us about your space, your vision and the details that matter to you. From the first conversation to final installation, FURNIQOS brings every element together with precision and purpose.",
    bgImage: "/assets/images/cta_banner_bg.jpg"
  }
};

if (!fs.existsSync(CONTENT_FILE)) {
  safeWrite(CONTENT_FILE, DEFAULT_CONTENT);
}

// Initialize Supabase if keys provided
let supabase = null;
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  // The service role key works with Row Level Security on; the anon key is the fallback
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (url && key && url.trim() !== '' && key.trim() !== '') {
    if (!supabase) {
      supabase = createClient(url, key);
      console.log('Supabase client initialized successfully.');
    }
    return supabase;
  }
  return null;
}

// Local File Helpers
function readLocalLeads() {
  try {
    const data = fs.readFileSync(LEADS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function writeLocalLeads(leads) {
  safeWrite(LEADS_FILE, leads);
}

function readLocalContent() {
  try {
    const data = fs.readFileSync(CONTENT_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return DEFAULT_CONTENT;
  }
}

function writeLocalContent(content) {
  if (!safeWrite(CONTENT_FILE, content)) throw new Error('Content storage is not writable on this host.');
}

// Database Operations
const db = {
  // Save Lead
  async createLead(leadData) {
    const lead = {
      id: 'lead_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: leadData.name || '',
      email: leadData.email || '',
      phone: leadData.phone || '',
      project_type: leadData.project_type || 'Residential',
      message: leadData.message || '',
      source: leadData.source || 'Website Home Form',
      status: 'New', // New, Contacted, In Progress, Converted, Archived
      notes: '',
      created_at: new Date().toISOString()
    };

    // Save locally first
    const leads = readLocalLeads();
    leads.unshift(lead);
    writeLocalLeads(leads);

    // Save to Supabase if configured
    const supa = getSupabaseClient();
    if (supa) {
      try {
        const { error } = await supa.from('leads').insert([{
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          project_type: lead.project_type,
          message: lead.message,
          status: lead.status,
          source: lead.source,
          created_at: lead.created_at
        }]);
        if (error) {
          console.warn('Supabase lead insert warning (table might need creation):', error.message);
        } else {
          console.log('Lead synced to Supabase successfully.');
        }
      } catch (err) {
        console.warn('Supabase sync error:', err.message);
      }
    }

    return lead;
  },

  // Get all leads with optional filtering
  async getLeads(filters = {}) {
    let leads = readLocalLeads();

    // Supabase optional sync
    const supa = getSupabaseClient();
    if (supa) {
      try {
        const { data, error } = await supa.from('leads').select('*').order('created_at', { ascending: false });
        if (!error && Array.isArray(data) && data.length > 0) {
          // Merge with local if any missing
          leads = data;
        }
      } catch (e) {}
    }

    // Apply filtering
    if (filters.status && filters.status !== 'all') {
      leads = leads.filter(l => l.status.toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.project_type && filters.project_type !== 'all') {
      leads = leads.filter(l => l.project_type.toLowerCase() === filters.project_type.toLowerCase());
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      leads = leads.filter(l => 
        (l.name && l.name.toLowerCase().includes(q)) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.phone && l.phone.toLowerCase().includes(q)) ||
        (l.message && l.message.toLowerCase().includes(q))
      );
    }

    return leads;
  },

  // Update lead status or notes
  async updateLead(id, updates) {
    const leads = readLocalLeads();
    const index = leads.findIndex(l => l.id === id);
    if (index === -1) return null;

    leads[index] = { ...leads[index], ...updates, updated_at: new Date().toISOString() };
    writeLocalLeads(leads);

    const supa = getSupabaseClient();
    if (supa) {
      try {
        await supa.from('leads').update(updates).eq('id', id);
      } catch (e) {}
    }

    return leads[index];
  },

  // Delete lead
  async deleteLead(id) {
    let leads = readLocalLeads();
    leads = leads.filter(l => l.id !== id);
    writeLocalLeads(leads);

    const supa = getSupabaseClient();
    if (supa) {
      try {
        await supa.from('leads').delete().eq('id', id);
      } catch (e) {}
    }
    return true;
  },

  // Get Site Content
  getContent() {
    return readLocalContent();
  },

  // Update Site Content
  updateContent(newContent) {
    const current = readLocalContent();
    const updated = { ...current, ...newContent };
    writeLocalContent(updated);
    return updated;
  }
};

module.exports = db;
