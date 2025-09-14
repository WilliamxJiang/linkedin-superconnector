// Three.js Network Visualizer for Chrome Extension
// Using bundled Three.js files to avoid CSP issues

console.log('Loading Three.js Network Visualizer...');

// Import bundled Three.js modules
import * as THREE from './three-bundle.js';
import { OrbitControls } from './orbit-controls-bundle.js';
import { CSS2DRenderer, CSS2DObject } from './css2d-renderer-bundle.js';

/* ================================
 * NATURAL LANGUAGE ROUTER PROMPT
 * ================================
 * The LLM must always return STRICT JSON with one of two actions:
 *  - "path": find the optimal path to a person already in the graph
 *  - "search": do a LinkedIn search for relevant people
 *
 * Fields:
 * {
 *   "action": "path" | "search",
 *   "reason": string,
 *   "target_name": string | null,       // for "path"
 *   "target_company": string | null,    // optional hints for "path"
 *   "keywords": string[],               // for "search"
 *   "query": string                     // normalized user request
 * }
 *
 * The model will receive a list of known people (current nodes) as context.
 */
const ROUTER_SYSTEM_PROMPT = `
You are a routing assistant embedded in a LinkedIn graph tool.

Your job: choose ONE action for each user query.
- Use "path" when the user likely wants an introduction, warm intro, how to reach a specific person, or a route via connections already shown in the current graph.
- Use "search" when the user asks to find people broadly (e.g., "PMs at Stripe", "AI safety researchers in SF"), or when the target is probably NOT in the graph.

Return STRICT JSON ONLY. NO prose, NO code fences.

JSON schema:
{
  "action": "path" | "search",
  "reason": string,
  "target_name": string | null,
  "target_company": string | null,
  "keywords": string[],   // for "search"
  "query": string
}

Rules:
- If the user asks about a named person (e.g., "Sundar Pichai", "Jane Doe"), prefer "path".
- If the user asks to "find", "who", "show me", "list", job titles, or broad criteria, prefer "search".
- If unsure whether the person exists in the current graph, still decide. Do NOT return ambiguity.
- Always output valid JSON with BOTH keys for the chosen action AND placeholders (null/[] as appropriate) for the other fields.
`.trim();

/* Helper to build a user message with current context */
function buildRouterUserMessage(userQuery, knownPeople) {
  const knownLines = knownPeople.map(p => `- ${p.name}${p.description ? ' | ' + p.description : ''}`).join('\n');
  return `
User query:
"${userQuery}"

Known people currently in the graph (may be partial):
${knownLines}

Decide the single best action and return STRICT JSON only.
`.trim();
}

/* Robust JSON extraction (handles code fences or stray text) */
function safeJsonFromText(text) {
  try {
    // First try direct parse
    return JSON.parse(text);
  } catch {
    // Try extracting the first {...} block
    const match = text.match(/\{[\s\S]*\}$/m);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    // Try code-fence cleanup
    const fence = text.replace(/```(?:json)?/g, '').trim();
    try { return JSON.parse(fence); } catch {}
  }
  return null;
}

/* Dummy LinkedIn search (placeholder for your real integration) */
function linkedinSearchDummy({ keywords, query }) {
  console.log('[LinkedIn Search Dummy] Query:', query, 'Keywords:', keywords);
  toast(`Searching LinkedIn for: ${keywords?.join(', ') || query}`);
  // TODO: Replace with your actual LinkedIn search logic.
}

/* A tiny toast to show actions to the user */
function toast(msg, ms = 2200) {
  let el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: rgba(15,20,35,.9); color: #e6ecff; padding: 10px 14px;
    border-radius: 8px; font-size: 13px; z-index: 999999; box-shadow: 0 6px 24px rgba(0,0,0,.35);
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Scraper data integration with profile picture support
const sample_data = await chrome.storage.local.get('lsc-latest-profiles').then(res => res['lsc-latest-profiles']);
let graph;
console.log('=== SCRAPER DATA DEBUG ===');
console.log('Raw sample_data:', sample_data);
console.log('Type:', typeof sample_data);
console.log('Is array:', Array.isArray(sample_data));
if (sample_data && sample_data.length > 0) {
  console.log('First profile:', sample_data[0]);
}
if (sample_data) {
  try {
    // const parsed = JSON.parse(sample_data) // expected: array of profile objects
    const parsed = sample_data;
    // normalize to array
    const profiles = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    if (!Array.isArray(profiles)) throw new Error('Profiles JSON is not an array');

    // helper: stable id from profile_url or index
    const toId = (p, i) => {
      if (typeof p?.profile_url === 'string' && p.profile_url.trim()) {
        const seg = p.profile_url.split('/').filter(Boolean).pop() || `n${i}`;
        return seg.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || `n${i}`;
      }
      return `n${i}`;
    };

    // helper: extract name from full_name, first_name + last_name, or scraper name field
    const toName = (p) => {
      if (typeof p?.full_name === 'string' && p.full_name.trim()) return p.full_name.trim();
      if (typeof p?.name === 'string' && p.name.trim()) return p.name.trim();
      const first = p?.first_name?.trim() || '';
      const last = p?.last_name?.trim() || '';
      return `${first} ${last}`.trim() || 'Unknown';
    };

    // helper: extract company from current_company, company, or scraper description
    const toCompany = (p) => {
      if (p?.current_company?.trim()) return p.current_company.trim();
      if (p?.company?.trim()) return p.company.trim();
      if (p?.description?.trim()) {
        const desc = p.description.trim();
        const atMatch = desc.match(/(?:at|@)\s*([^,•]+)/i);
        if (atMatch) return atMatch[1].trim();
        const bulletMatch = desc.match(/^([^•]+)\s*•/);
        if (bulletMatch) return bulletMatch[1].trim();
      }
      return 'Unknown';
    };

    const toSchool = (p) => {
      if (Array.isArray(p?.education) && p.education.length > 0) {
        return p.education[0]?.school?.trim() || 'Unknown';
      }
      if (p?.description?.trim()) {
        const desc = p.description.trim();
        const schoolMatch = desc.match(/(?:university|college|institute|school)\s+of\s+([^,•]+)/i);
        if (schoolMatch) return schoolMatch[1].trim();
      }
      return 'Unknown';
    };

    const toRole = (p) => {
      if (p?.current_title?.trim()) return p.current_title.trim();
      if (p?.title?.trim()) return p.title.trim();
      if (p?.description?.trim()) {
        const desc = p.description.trim();
        const roleMatch = desc.match(/^([^@•]+?)(?:\s+at\s+|\s*•)/i);
        if (roleMatch) return roleMatch[1].trim();
      }
      return 'Unknown';
    };

    const toDescription = (p) => {
      if (p?.description?.trim()) return p.description.trim();
    }

    const toProfilePic = (p) => {
      if (p?.profile_picture_url?.trim()) return p.profile_picture_url.trim();
      if (p?.profile_pic?.trim()) return p.profile_pic.trim();
      if (p?.img?.trim()) return p.img.trim();
      return null;
    };

    // Filter out dud profiles (no name, invalid data, etc.)
    const validProfiles = profiles.filter((p, i) => {
      const name = toName(p);
      const id = toId(p, i);
      if (!name || name === 'Unknown' || name.trim() === '' || name.length < 2) {
        console.log(`Filtering out dud profile ${i}: no valid name (${name})`);
        return false;
      }
      if (!id || id.length < 2) {
        console.log(`Filtering out dud profile ${i}: no valid ID (${id})`);
        return false;
      }
      if (!p || typeof p !== 'object' || Object.keys(p).length === 0) {
        console.log(`Filtering out dud profile ${i}: empty object`);
        return false;
      }
      if (name.length < 3 || name === name.charAt(0).repeat(name.length)) {
        console.log(`Filtering out dud profile ${i}: suspicious name (${name})`);
        return false;
      }
      return true;
    });
    
    // Deduplicate
    const uniqueProfiles = [];
    const seenIds = new Set();
    validProfiles.forEach((p, i) => {
      const id = toId(p, i);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        uniqueProfiles.push(p);
      } else {
        console.log(`Removing duplicate profile with ID: ${id}`);
      }
    });
    
    console.log(`Deduplicated ${validProfiles.length} profiles down to ${uniqueProfiles.length} unique profiles`);
    
    // build nodes array - start with "You" node
    const nodes = [
      {
        id: 'me',
        name: 'You',
        degree: 1,
        company: 'Your Company',
        school: 'Your School',
        role: 'Your Role',
        profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'
      }
    ];
    
    const usedIds = new Set(['me']);
    uniqueProfiles.forEach((p, i) => {
      const toIdLocal = (p, i) => {
        if (typeof p?.profile_url === 'string' && p.profile_url.trim()) {
          const seg = p.profile_url.split('/').filter(Boolean).pop() || `n${i}`;
          return seg.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || `n${i}`;
        }
        return `n${i}`;
      };
      let nodeId = toIdLocal(p, i);
      let counter = 1;
      while (usedIds.has(nodeId)) {
        nodeId = toIdLocal(p, i) + counter;
        counter++;
      }
      usedIds.add(nodeId);
      const node = {
        id: nodeId,
        name: (p?.full_name || p?.name || `${p?.first_name || ''} ${p?.last_name || ''}`).trim() || 'Unknown',
        degree: 1,
        // company: (p?.current_company || p?.company || '').trim() || 'Unknown',
        company: toCompany(p),
        school: toSchool(p),
        role: toRole(p),
        profilePic: toProfilePic(p),
        description: toDescription(p)
      };
      nodes.push(node);
    });

    // build edges array (You -> everyone)
    const edges = [];
    for (let i = 1; i < nodes.length; i++) {
      const targetNode = nodes[i];
      if (targetNode && targetNode.id) {
        edges.push({
          source: 'me',
          target: targetNode.id,
          weight: Math.random() * 0.5 + 0.3,
          reasons: ['Scraped connection']
        });
      }
    }

    // Safety: ensure connected
    const connectedNodeIds = new Set();
    edges.forEach(edge => {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    });
    const orphanedNodes = nodes.filter(node => node.id !== 'me' && !connectedNodeIds.has(node.id));
    orphanedNodes.forEach(node => {
      edges.push({ source: 'me', target: node.id, weight: 0.5, reasons: ['Orphaned node connection'] });
    });

    graph = { nodes, edges };
    console.log('=== PARSED GRAPH DEBUG ===');
    console.log('Number of nodes:', nodes.length);
    console.log('Number of edges:', edges.length);
    console.log('First few nodes:', nodes.slice(0, 3));
    console.log('First few edges:', edges.slice(0, 3));
    console.log('Full graph:', graph);
  } catch (error) {
    console.error('Error parsing scraped data:', error);
    // Fallback to sample data if parsing fails
    graph = {
      nodes: [
        {id:'me', name:'You', degree:1, company:'Ada', school:'UofT', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
        {id:'a',  name:'Alex Chen', degree:1, company:'Stripe', school:'UofT', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
        {id:'b',  name:'Bianca Patel', degree:1, company:'Meta', school:'Waterloo', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
        {id:'d',  name:'Priya N.', degree:2, company:'Google', role:'Manager', school:'MIT', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
        {id:'e',  name:'Sarah Kim', degree:1, company:'Apple', school:'Stanford', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
        {id:'f',  name:'Mike Johnson', degree:1, company:'Microsoft', school:'MIT', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'}
      ],
      edges: [
        {source:'me', target:'a', weight:0.8, reasons:['Direct connection']},
        {source:'a',  target:'d', weight:0.6, reasons:['Same school']},
        {source:'me', target:'b', weight:0.4, reasons:['Same region']},
        {source:'d', target:'e', weight:0.7, reasons:['Tech industry']},
        {source:'e', target:'f', weight:0.5, reasons:['Tech industry']},
        {source:'b', target:'f', weight:0.3, reasons:['Tech industry']}
      ]
    };
  }
} else {
  // Fallback to sample data if no scraped data
  graph = {
    nodes: [
      {id:'me', name:'You', degree:1, company:'Ada', school:'UofT', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
      {id:'a',  name:'Alex Chen', degree:1, company:'Stripe', school:'UofT', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
      {id:'b',  name:'Bianca Patel', degree:1, company:'Meta', school:'Waterloo', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
      {id:'d',  name:'Priya N.', degree:2, company:'Google', role:'Manager', school:'MIT', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
      {id:'e',  name:'Sarah Kim', degree:1, company:'Apple', school:'Stanford', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'},
      {id:'f',  name:'Mike Johnson', degree:1, company:'Microsoft', school:'MIT', profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM'}
    ],
    edges: [
      {source:'me', target:'a', weight:0.8, reasons:['Direct connection']},
      {source:'a',  target:'d', weight:0.6, reasons:['Same school']},
      {source:'me', target:'b', weight:0.4, reasons:['Same region']},
      {source:'d', target:'e', weight:0.7, reasons:['Tech industry']},
      {source:'e', target:'f', weight:0.5, reasons:['Tech industry']},
      {source:'b', target:'f', weight:0.3, reasons:['Tech industry']}
    ]
  };
}

// use `graph` downstream
console.log('graph', graph);

const sample = graph;

// Scene setup
const app = document.getElementById("app");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#0b1020");

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 2000);
camera.position.set(250, 250, 250);

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.top = "0";
labelRenderer.domElement.style.pointerEvents = "none";
app.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Add lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 10, 5);
scene.add(directionalLight);

// Graph drawing
const nodeGroup = new THREE.Group();
const edgeGroup = new THREE.Group();
scene.add(nodeGroup, edgeGroup);

const nodeObjs = new Map();
const nodeAnimations = new Map();
let currentOptimalPath = { edges: new Set(), path: [] };
let currentTarget = null;
let highlightedNodes = new Set();
let is3DMode = true; // Track current view mode
let frozenZPositions = new Map(); // Store Z positions when in 2D mode
let hoveredNode = null;
let hoveredNodeOriginalScale = null;
let networkRotationSpeed = 0.0005; // Very slow clockwise rotation speed

// Clear any existing nodes to prevent duplicates
nodeGroup.clear();
nodeObjs.clear();
nodeAnimations.clear();

// Create nodes
sample.nodes.forEach((n, idx) => {
  if (nodeObjs.has(n.id)) return;
  const glowNode = new THREE.Group();
  let nodeColor = (n.id === 'me') ? 0x4CAF50 : 0x4DA6FF;
  let outerGlow = null, innerGlow = null;

  if (!n.profilePic) {
    const glowSize = n.id === 'me' ? 24 : 18;
    outerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(glowSize, 16, 12),
      new THREE.MeshBasicMaterial({ 
        color: nodeColor, transparent: true, opacity: n.id === 'me' ? 0.08 : 0.05,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, fog: false
      })
    );
    glowNode.add(outerGlow);

    const innerGlowSize = n.id === 'me' ? 15 : 12;
    innerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(innerGlowSize, 16, 12),
      new THREE.MeshBasicMaterial({ 
        color: nodeColor, transparent: true, opacity: n.id === 'me' ? 0.15 : 0.1,
        blending: THREE.AdditiveBlending, fog: false
      })
    );
    glowNode.add(innerGlow);
  }
  
  let core;
  if (n.profilePic) {
    const loader = new THREE.TextureLoader();
    try {
      const profileTexture = loader.load(n.profilePic);
      const nodeSize = n.id === 'me' ? 30 : 24;
      const nodeGeometry = new THREE.CircleGeometry(nodeSize/2, 32);
      const vertices = nodeGeometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i), y = vertices.getY(i);
        const distanceFromCenter = Math.sqrt(x*x + y*y);
        const maxDistance = nodeSize / 2;
        const normalizedDistance = Math.min(distanceFromCenter / maxDistance, 1);
        const curveHeight = Math.cos(normalizedDistance * Math.PI / 2) * 1.5;
        vertices.setZ(i, curveHeight);
      }
      vertices.needsUpdate = true;
      const nodeMaterial = new THREE.MeshBasicMaterial({
        map: profileTexture, color: 0xffffff, transparent: false, opacity: 1.0,
        side: THREE.DoubleSide, depthWrite: true, depthTest: true, alphaTest: 0.5
      });
      core = new THREE.Mesh(nodeGeometry, nodeMaterial);
      core.renderOrder = 100;
      core.material.depthWrite = true;
      core.material.depthTest = true;
      core.material.transparent = false;
      core.material.opacity = 1.0;

      const glowSizes = n.id === 'me' ? [40, 35, 30] : [32, 28, 24];
      const glowOpacities = n.id === 'me' ? [0.15, 0.2, 0.25] : [0.1, 0.15, 0.2];
      glowSizes.forEach((glowSize, index) => {
        const innerRadius = nodeSize/2 + 2;
        const outerRadius = glowSize/2;
        const glowGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: nodeColor, transparent: true, opacity: glowOpacities[index],
          side: THREE.DoubleSide, depthWrite: false, depthTest: false,
          blending: THREE.AdditiveBlending, fog: false
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.position.z = -0.1 - (index * 0.05);
        glow.renderOrder = 1;
        glow.userData.isGlow = true;
        glow.userData.isBillboard = true;
        glow.userData.glowIndex = index;
        glowNode.add(glow);
      });
      core.userData.isBillboard = true;
    } catch (err) {
      const coreSize = n.id === 'me' ? 8 : 6;
      const coreGeometry = new THREE.SphereGeometry(coreSize, 16, 12);
      const coreMaterial = new THREE.MeshBasicMaterial({ color: nodeColor, transparent: true, opacity: 0.8 });
      core = new THREE.Mesh(coreGeometry, coreMaterial);
    }
  } else {
    const coreSize = n.id === 'me' ? 8 : 6;
    const coreGeometry = new THREE.SphereGeometry(coreSize, 16, 12);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: nodeColor, transparent: true, opacity: 0.8 });
    core = new THREE.Mesh(coreGeometry, coreMaterial);
  }

  glowNode.add(core);
  
  if (n.id === 'me') {
    glowNode.position.set(0, 0, 0);
  } else {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = 2 * Math.PI * Math.random();
    const radius = 120 + Math.random() * 120;
    glowNode.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi)
    );
  }
  glowNode.renderOrder = 10;
  nodeGroup.add(glowNode);
  nodeObjs.set(n.id, glowNode);

  const labelDiv = document.createElement("div");
  labelDiv.className = "tooltip";
  let labelText = n.id === 'me' ? 'You' : n.name;
  if (n.id !== 'me') {
    if (n.role && n.role !== 'Unknown' && n.company && n.company !== 'Unknown') labelText += `, ${n.role} @ ${n.company}`;
    else if (n.company && n.company !== 'Unknown') labelText += ` @ ${n.company}`;
    else if (n.role && n.role !== 'Unknown') labelText += `, ${n.role}`;
  }
  labelDiv.textContent = labelText;
  if (n.id === 'me') {
    labelDiv.style.display = 'block';
    labelDiv.style.visibility = 'visible';
    labelDiv.style.opacity = '1';
  } else {
    labelDiv.style.display = 'none';
    labelDiv.style.visibility = 'hidden';
    labelDiv.style.opacity = '0';
  }
  const label = new CSS2DObject(labelDiv);
  label.position.set(0, -15, 0);
  glowNode.add(label);
  glowNode.userData = { nodeId: n.id, label: labelDiv, originalScale: 1 };

  nodeAnimations.set(n.id, {
    originalPos: glowNode.position.clone(),
    timeOffset: Math.random()*Math.PI*2,
    amplitude: 2 + Math.random()*3,
    frequency: 0.5 + Math.random()*0.5,
    scaleAmplitude: 0.1 + Math.random()*0.1,
    scaleFrequency: 0.3 + Math.random()*0.4,
    glowNode: glowNode,
    outerGlow: outerGlow,
    innerGlow: innerGlow,
    core: core
  });
});

// Create edges
const edgeLines = new Map();
sample.edges.forEach(e => {
  const s = nodeObjs.get(e.source);
  const t = nodeObjs.get(e.target);
  if (!s || !t) return;
  const geom = new THREE.BufferGeometry().setFromPoints([s.position, t.position]);
  const color = 0x9aa7c6, opacity = 0.6;
  const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ 
    color, transparent: true, opacity, depthTest: true, depthWrite: true, alphaTest: 0.1
  }));
  line.renderOrder = -10;
  line.material.depthWrite = true;
  line.material.depthTest = true;
  line.material.transparent = true;
  line.material.opacity = 0.6;
  edgeGroup.add(line);
  edgeLines.set(`${e.source}-${e.target}`, line);
});

// Zoom in on optimal path nodes
function zoomToOptimalPath() {
  if (!currentOptimalPath || currentOptimalPath.path.length === 0) return;
  const pathNodes = currentOptimalPath.path.map(nodeId => nodeObjs.get(nodeId)).filter(Boolean);
  if (pathNodes.length === 0) return;
  const box = new THREE.Box3();
  pathNodes.forEach(node => box.expandByObject(node));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2;
  const direction = new THREE.Vector3().subVectors(camera.position, center).normalize();
  const newPosition = center.clone().add(direction.multiplyScalar(distance));
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const newTarget = center.clone();
  let progress = 0;
  const duration = 1000;
  const startTime = performance.now();
  function animateCamera() {
    const elapsed = performance.now() - startTime;
    progress = Math.min(elapsed / duration, 1);
    const ease = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
    const p = ease(progress);
    camera.position.lerpVectors(startPosition, newPosition, p);
    controls.target.lerpVectors(startTarget, newTarget, p);
    controls.update();
    if (progress < 1) requestAnimationFrame(animateCamera);
  }
  animateCamera();
}

// Find optimal path from 'me' to a specific target node
function findOptimalPathToTarget(targetId) {
  if (targetId === 'me') return { edges: new Set(), path: ['me'] };
  const visited = new Set();
  const queue = [{ node: 'me', path: ['me'], weight: 0 }];
  while (queue.length > 0) {
    const { node, path, weight } = queue.shift();
    if (node === targetId) {
      const optimalEdges = new Set();
      for (let i = 0; i < path.length - 1; i++) {
        optimalEdges.add(`${path[i]}-${path[i + 1]}`);
      }
      return { edges: optimalEdges, path };
    }
    if (visited.has(node)) continue;
    visited.add(node);
    const outgoing = sample.edges.filter(e => e.source === node && !visited.has(e.target));
    for (const edge of outgoing) {
      queue.push({ node: edge.target, path: [...path, edge.target], weight: weight + edge.weight });
    }
    queue.sort((a, b) => b.weight - a.weight);
  }
  return { edges: new Set(), path: [] };
}

function updateEdges(){
  sample.edges.forEach(e=>{
    const line = edgeLines.get(`${e.source}-${e.target}`);
    if(!line) return;
    const s = nodeObjs.get(e.source), t = nodeObjs.get(e.target);
    if(!s || !t) return;
    line.geometry.setFromPoints([s.position, t.position]);
  });
}

// Node highlighting functions
function highlightNode(nodeId, highlightType = 'none') {
  const node = nodeObjs.get(nodeId);
  if (!node) return;
  const originalColor = nodeId === 'me' ? 0x4CAF50 : 0x4DA6FF;
  if (highlightType === 'target') {
    highlightedNodes.add(nodeId);
    node.children.forEach(child => {
      if (!child.material) return;
      if (child.userData.isBillboard) {
        // keep profile pic unchanged
      } else if (child.userData.isGlow) {
        child.material.color.setHex(0xFF7043);
        child.material.opacity = Math.min(child.material.opacity * 2.5, 1.0);
      } else {
        child.material.color.setHex(0xFF7043);
      }
    });
    if (node.userData?.glowNode) {
      node.userData.glowNode.children.forEach(child => {
        if (child.material?.emissive) {
          child.material.emissive.setHex(0x331100);
          child.material.emissiveIntensity = 0.3;
        }
      });
    }
    if (node.userData?.label) {
      node.userData.label.style.display = 'block';
      node.userData.label.style.visibility = 'visible';
      node.userData.label.style.opacity = '1';
    }
  } else if (highlightType === 'intermediate') {
    highlightedNodes.add(nodeId);
    node.children.forEach(child => {
      if (!child.material) return;
      if (child.userData.isBillboard) {
      } else if (child.userData.isGlow) {
        child.material.color.setHex(0xffd700);
        child.material.opacity = Math.min(child.material.opacity * 2.5, 1.0);
      } else {
        child.material.color.setHex(0xffd700);
      }
    });
    if (node.userData?.glowNode) {
      node.userData.glowNode.children.forEach(child => {
        if (child.material?.emissive) {
          child.material.emissive.setHex(0x332200);
          child.material.emissiveIntensity = 0.2;
        }
      });
    }
  } else {
    highlightedNodes.delete(nodeId);
    node.children.forEach(child => {
      if (!child.material) return;
      if (child.userData.isBillboard) {
      } else if (child.userData.isGlow) {
        child.material.color.setHex(originalColor);
        const originalOpacities = nodeId === 'me' ? [0.4, 0.5, 0.6] : [0.3, 0.4, 0.5];
        child.material.opacity = originalOpacities[child.userData.glowIndex] || 0.3;
      } else {
        child.material.color.setHex(originalColor);
      }
    });
    if (node.userData?.glowNode) {
      node.userData.glowNode.children.forEach(child => {
        if (child.material?.emissive) {
          child.material.emissive.setHex(0x000000);
          child.material.emissiveIntensity = 0;
        }
      });
    }
  }
}

function updateOptimalPath(targetId) {
  if (currentTarget && currentTarget !== 'me') {
    const prev = nodeObjs.get(currentTarget);
    if (prev?.userData?.label) {
      prev.userData.label.style.display = 'none';
      prev.userData.label.style.visibility = 'hidden';
      prev.userData.label.style.opacity = '0';
    }
  }
  highlightedNodes.forEach(nodeId => highlightNode(nodeId, 'none'));
  highlightedNodes.clear();
  currentTarget = targetId;
  currentOptimalPath = findOptimalPathToTarget(targetId);

  currentOptimalPath.path.forEach((nodeId) => {
    if (nodeId !== 'me') {
      if (nodeId === targetId) highlightNode(nodeId, 'target');
      else highlightNode(nodeId, 'intermediate');
    }
  });

  sample.edges.forEach(e => {
    const line = edgeLines.get(`${e.source}-${e.target}`);
    if (!line) return;
    const isOptimal = currentOptimalPath.edges.has(`${e.source}-${e.target}`);
    if (isOptimal) {
      line.visible = false;
      const s = nodeObjs.get(e.source);
      const t = nodeObjs.get(e.target);
      if (s && t) {
        const direction = new THREE.Vector3().subVectors(t.position, s.position);
        const length = direction.length();
        const midpoint = new THREE.Vector3().addVectors(s.position, t.position).multiplyScalar(0.5);
        const cylinderGeometry = new THREE.CylinderGeometry(0.6, 0.6, length, 8);
        const cylinderMaterial = new THREE.MeshBasicMaterial({ color: 0xFFD700, transparent: true, opacity: 0.9 });
        const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
        cylinder.position.copy(midpoint);
        cylinder.lookAt(t.position);
        cylinder.rotateX(Math.PI / 2);
        cylinder.renderOrder = -5;
        cylinder.userData = { isOptimalEdge: true, edgeKey: `${e.source}-${e.target}` };
        edgeGroup.add(cylinder);
      }
    } else {
      line.visible = true;
      edgeGroup.children.forEach(child => {
        if (child.userData?.isOptimalEdge && child.userData.edgeKey === `${e.source}-${e.target}`) {
          edgeGroup.remove(child);
        }
      });
      let color, opacity;
      if (e.weight >= 0.7) { color = 0x4da6ff; opacity = 0.9; }
      else if (e.weight >= 0.5) { color = 0x6b9bd2; opacity = 0.8; }
      else { color = 0x9aa7c6; opacity = 0.6; }
      line.material.color.setHex(color);
      line.material.opacity = opacity;
    }
  });

  updateSidebarInfo();
  zoomToOptimalPath();
}

function updateSidebarInfo() {
  const optimalPathDiv = document.querySelector('.optimal-path-info');
  if (!optimalPathDiv) return;
  if (!currentTarget || currentOptimalPath.path.length === 0) {
    optimalPathDiv.style.display = 'none';
    return;
  }
  const targetNode = sample.nodes.find(n => n.id === currentTarget);
  const pathNames = currentOptimalPath.path.map(id => (sample.nodes.find(n => n.id === id)?.name) || id);
  optimalPathDiv.style.display = 'block';
  optimalPathDiv.innerHTML = `
    <strong>Optimal Path to ${targetNode ? targetNode.name : 'Target'}:</strong><br>
    ${pathNames.join(' → ')}<br>
    <em style="color: #FFD700; cursor: pointer; text-decoration: underline;">Click to zoom in on path</em>
  `;
  optimalPathDiv.style.cursor = 'pointer';
  optimalPathDiv.onclick = zoomToOptimalPath;
}

// Hover effect functions
function applyHoverEffect(node) {
  if (!node.userData) return;
  hoveredNodeOriginalScale = node.scale.clone();
  node.scale.multiplyScalar(1.3);
  if (node.userData.label) {
    node.userData.label.style.display = 'block';
    node.userData.label.style.visibility = 'visible';
    node.userData.label.style.opacity = '1';
  }
  renderer.domElement.style.cursor = 'pointer';
}
function resetHoverEffect(node) {
  if (!node.userData) return;
  if (hoveredNodeOriginalScale) node.scale.copy(hoveredNodeOriginalScale);
  if (node.userData.label && node.userData.nodeId !== 'me' && node.userData.nodeId !== currentTarget) {
    node.userData.label.style.display = 'none';
    node.userData.label.style.visibility = 'hidden';
    node.userData.label.style.opacity = '0';
  }
  renderer.domElement.style.cursor = 'default';
}

// Dragging functionality
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const planeIntersect = new THREE.Vector3();
let isDragging = false;
let draggedNode = null;
const dragOffset = new THREE.Vector3();

renderer.domElement.style.touchAction = "none";

function setPointer(ev){
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left)/r.width)*2 - 1;
  pointer.y = -((ev.clientY - r.top)/r.height)*2 + 1;
}
function pickNode(ev){
  setPointer(ev);
  raycaster.setFromCamera(pointer, camera);
  const nodeArray = Array.from(nodeObjs.values());
  const intersects = raycaster.intersectObjects(nodeArray, true);
  if(intersects.length > 0) {
    let parent = intersects[0].object.parent;
    while(parent && !nodeArray.includes(parent)) parent = parent.parent;
    return parent || intersects[0].object;
  }
  return null;
}
function onPointerDown(ev){
  const obj = pickNode(ev);
  if(obj) {
    const camDir = new THREE.Vector3(); 
    camera.getWorldDirection(camDir);
    dragPlane.setFromNormalAndCoplanarPoint(camDir, obj.position);
    raycaster.ray.intersectPlane(dragPlane, planeIntersect);
    dragOffset.copy(obj.position).sub(planeIntersect);
    draggedNode = obj;
    isDragging = true;
    controls.enabled = false;
    renderer.domElement.setPointerCapture?.(ev.pointerId);
  } else {
    controls.enabled = true;
    isDragging = false;
    draggedNode = null;
  }
}
function onPointerMove(ev){
  if(isDragging && draggedNode) {
    setPointer(ev);
    raycaster.setFromCamera(pointer, camera);
    if(raycaster.ray.intersectPlane(dragPlane, planeIntersect)){
      draggedNode.position.copy(planeIntersect).add(dragOffset);
      if (!is3DMode) draggedNode.position.z = 0;
      const id = [...nodeObjs.entries()].find(([_, n]) => n === draggedNode)?.[0];
      if(id){
        const anim = nodeAnimations.get(id);
        if(anim) anim.originalPos.copy(draggedNode.position);
      }
      updateEdges();
    }
  } else {
    setPointer(ev);
    raycaster.setFromCamera(pointer, camera);
    const nodeArray = Array.from(nodeObjs.values());
    const intersects = raycaster.intersectObjects(nodeArray, true);
    if(intersects.length > 0) {
      let parent = intersects[0].object.parent;
      while(parent && !nodeArray.includes(parent)) parent = parent.parent;
      if(parent && parent !== hoveredNode) {
        if(hoveredNode) resetHoverEffect(hoveredNode);
        hoveredNode = parent;
        applyHoverEffect(hoveredNode);
      }
    } else if(hoveredNode) {
      resetHoverEffect(hoveredNode);
      hoveredNode = null;
    }
  }
}
function onPointerUp(ev){
  if(isDragging) {
    isDragging = false;
    draggedNode = null;
    controls.enabled = true;
    try { renderer.domElement.releasePointerCapture?.(ev.pointerId); } catch {}
  }
}
renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerup', onPointerUp);
renderer.domElement.addEventListener('pointerleave', onPointerUp);

// Search box (manual)
const searchInput = document.getElementById('search');
const highlightButton = document.getElementById('highlight');
function searchAndHighlight() {
  const searchTerm = searchInput.value.toLowerCase().trim();
  if (!searchTerm) return;
  const matchingNode = sample.nodes.find(node => 
    node.name.toLowerCase().includes(searchTerm) || 
    (node.company && node.company.toLowerCase().includes(searchTerm))
  );
  if (matchingNode) {
    updateOptimalPath(matchingNode.id);
  } else {
    const availableNames = sample.nodes.map(n => n.name).join(', ');
    const availableCompanies = sample.nodes.filter(n => n.company).map(n => n.company).join(', ');
    alert(`No match found for "${searchTerm}".\n\nTry:\nNames: ${availableNames}\nCompanies: ${availableCompanies}`);
  }
}
highlightButton.addEventListener('click', searchAndHighlight);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchAndHighlight(); });

// 2D/3D Toggle functionality
const viewToggle3D = document.getElementById('viewToggle');
const viewToggle2D = document.getElementById('viewToggle2d');
viewToggle3D.addEventListener('click', () => switchTo3D());
viewToggle2D.addEventListener('click', () => switchTo2D());
function switchTo3D() { if (is3DMode) return; is3DMode = true; updateToggleButtons(); updateControlsForMode(); ensureRenderOrder(); animateToLayout('3d'); }
function switchTo2D() { if (!is3DMode) return; is3DMode = false; updateToggleButtons(); updateControlsForMode(); ensureRenderOrder(); animateToLayout('2d'); }
function updateToggleButtons() {
  viewToggle3D.classList.toggle('active', is3DMode);
  viewToggle2D.classList.toggle('active', !is3DMode);
}
function updateControlsForMode() {
  if (is3DMode) {
    controls.enableRotate = true; controls.enableZoom = true; controls.enablePan = true;
    controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
  } else {
    controls.enableRotate = true; controls.enableZoom = true; controls.enablePan = true;
    controls.minPolarAngle = Math.PI/2 - 0.1; controls.maxPolarAngle = Math.PI/2 + 0.1;
  }
}
function ensureRenderOrder() {
  nodeObjs.forEach((node) => {
    node.children.forEach(child => {
      if (child.userData.isBillboard && child.material) {
        child.renderOrder = 100;
        child.material.depthWrite = true;
        child.material.depthTest = true;
      }
    });
  });
  edgeGroup.children.forEach(edge => {
    edge.renderOrder = -10;
    if (edge.material) { edge.material.depthWrite = true; edge.material.depthTest = true; }
  });
  edgeGroup.children.forEach(cylinder => {
    if (cylinder.userData?.isOptimalEdge) {
      cylinder.renderOrder = -5;
      if (cylinder.material) { cylinder.material.depthWrite = true; cylinder.material.depthTest = true; }
    }
  });
}
function animateToLayout(mode) {
  const duration = 1000, startTime = performance.now();
  const originalPositions = new Map();
  nodeObjs.forEach((node, nodeId) => originalPositions.set(nodeId, node.position.clone()));
  const targetPositions = new Map();
  nodeObjs.forEach((node, nodeId) => {
    const currentPos = node.position.clone();
    let targetPos;
    if (mode === '2d') {
      targetPos = new THREE.Vector3(currentPos.x, currentPos.y, 0);
      frozenZPositions.set(nodeId, currentPos.z);
    } else {
      const frozenZ = frozenZPositions.get(nodeId);
      targetPos = (frozenZ !== undefined) ? new THREE.Vector3(currentPos.x, currentPos.y, frozenZ) : currentPos.clone();
      frozenZPositions.delete(nodeId);
    }
    targetPositions.set(nodeId, targetPos);
  });
  const targetCameraPos = mode === '2d' ? new THREE.Vector3(0, 0, 350) : new THREE.Vector3(250, 250, 250);
  const startCameraPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const targetControlsTarget = new THREE.Vector3(0, 0, 0);
  function animateLayout() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = (mode === '2d')
      ? (progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2)
      : (progress * progress * (3 - 2 * progress));
    nodeObjs.forEach((node, nodeId) => {
      const startPos = originalPositions.get(nodeId);
      const targetPos = targetPositions.get(nodeId);
      if (startPos && targetPos) node.position.lerpVectors(startPos, targetPos, eased);
    });
    camera.position.lerpVectors(startCameraPos, targetCameraPos, eased);
    controls.target.lerpVectors(startTarget, targetControlsTarget, eased);
    controls.update();
    if (progress < 1) requestAnimationFrame(animateLayout);
    else nodeObjs.forEach((node, nodeId) => nodeAnimations.get(nodeId)?.originalPos.copy(node.position));
  }
  animateLayout();
}

// Industry clustering analysis
function analyzeIndustryClusters() {
  const industryMap = new Map();
  sample.nodes.forEach(node => {
    if (node.company) {
      const industry = getIndustryFromCompany(node.company);
      if (!industryMap.has(industry)) industryMap.set(industry, []);
      industryMap.get(industry).push(node);
    }
  });
  let largestCluster = { industry: 'Unknown', count: 0, nodes: [] };
  for (const [industry, nodes] of industryMap) {
    if (nodes.length > largestCluster.count) largestCluster = { industry, count: nodes.length, nodes };
  }
  return largestCluster;
}
function getIndustryFromCompany(company) {
  const tech = ['Google','Meta','Apple','Microsoft','Stripe','Amazon','Netflix','Uber','Airbnb','Tesla','SpaceX','OpenAI','Anthropic'];
  const fin = ['Goldman Sachs','JPMorgan','Morgan Stanley','BlackRock','Vanguard','Fidelity','Wells Fargo','Bank of America','Citigroup'];
  const cons = ['McKinsey','Bain','BCG','Deloitte','PwC','EY','KPMG','Accenture'];
  if (tech.includes(company)) return 'Software Engineering';
  if (fin.includes(company)) return 'Finance';
  if (cons.includes(company)) return 'Consulting';
  return 'Other';
}
function updateLargestCluster() {
  const cluster = analyzeIndustryClusters();
  const clusterDiv = document.getElementById('largest-cluster');
  if (clusterDiv) clusterDiv.innerHTML = `Largest cluster: ${cluster.industry} (${cluster.count} people)`;
}
updateLargestCluster();

// Animation loop
function animate(){
  requestAnimationFrame(animate);
  const t = performance.now()*0.001;
  nodeObjs.forEach((node, id)=>{
    if(node === draggedNode || node === hoveredNode) return;
    const a = nodeAnimations.get(id); if(!a) return;
    const fx = Math.sin(t*a.frequency + a.timeOffset) * a.amplitude * 0.3;
    const fy = Math.sin(t*a.frequency*0.7 + a.timeOffset + Math.PI/3) * a.amplitude * 0.3;
    const fz = is3DMode ? Math.sin(t*a.frequency*0.5 + a.timeOffset + Math.PI/2) * a.amplitude * 0.4 : 0;
    node.position.set(a.originalPos.x + fx, a.originalPos.y + fy, a.originalPos.z + fz);
    if (!is3DMode) node.position.z = 0;
    node.children.forEach(child => {
      if (child.userData?.isBillboard && child.material) {
        child.renderOrder = 100;
        child.material.depthWrite = true;
        child.material.depthTest = true;
        child.material.transparent = false;
        child.material.opacity = 1.0;
        const worldPosition = new THREE.Vector3();
        child.getWorldPosition(worldPosition);
        const lookAtMatrix = new THREE.Matrix4();
        lookAtMatrix.lookAt(worldPosition, camera.position, camera.up);
        const quaternion = new THREE.Quaternion();
        quaternion.setFromRotationMatrix(lookAtMatrix);
        child.quaternion.copy(quaternion);
      }
    });
    const s = 1 + Math.sin(t*a.scaleFrequency + a.timeOffset)*a.scaleAmplitude;
    node.scale.setScalar(s);
    node.rotation.z = Math.sin(t*0.2 + a.timeOffset)*0.1;

    if(a.outerGlow && a.innerGlow && a.core) {
      const glowPulse = 1 + Math.sin(t*0.8 + a.timeOffset) * 0.3;
      const opacityPulse = 0.1 + Math.sin(t*1.2 + a.timeOffset) * 0.05;
      a.outerGlow.scale.setScalar(glowPulse);
      a.outerGlow.material.opacity = opacityPulse;
      a.innerGlow.scale.setScalar(glowPulse * 0.8);
      a.innerGlow.material.opacity = 0.3 + Math.sin(t*1.5 + a.timeOffset) * 0.1;
      a.core.scale.setScalar(glowPulse * 0.6);
    }
  });

  // Update optimal path cylinders
  if (currentOptimalPath && currentOptimalPath.edges.size > 0) {
    edgeGroup.children.forEach(child => {
      if (child.userData?.isOptimalEdge) {
        const [sourceId, targetId] = child.userData.edgeKey.split('-');
        const sourceNode = nodeObjs.get(sourceId);
        const targetNode = nodeObjs.get(targetId);
        if (sourceNode && targetNode) {
          const direction = new THREE.Vector3().subVectors(targetNode.position, sourceNode.position);
          const length = direction.length();
          const midpoint = new THREE.Vector3().addVectors(sourceNode.position, targetNode.position).multiplyScalar(0.5);
          child.position.copy(midpoint);
          child.lookAt(targetNode.position);
          child.rotateX(Math.PI / 2);
          child.scale.set(1, length / child.geometry.parameters.height, 1);
        }
      }
    });
  }

  // Gentle spin in 3D
  if (is3DMode) {
    const youNode = nodeObjs.get('me');
    if (youNode) {
      const youPosition = youNode.position.clone();
<<<<<<< HEAD
=======
      
      // Debug: Log rotation every 100 frames to avoid spam
      if (Math.floor(t * 60) % 100 === 0) {
        console.log(`Rotating network: is3DMode=${is3DMode}, youNode exists=${!!youNode}, speed=${networkRotationSpeed}`);
      }
      
>>>>>>> 5a303c9 (Make network rotation slower and add debug logging)
      nodeObjs.forEach((node, nodeId) => {
        if (nodeId !== 'me') {
          const relativePos = node.position.clone().sub(youPosition);
          const rotationMatrix = new THREE.Matrix4().makeRotationY(networkRotationSpeed);
          relativePos.applyMatrix4(rotationMatrix);
          node.position.copy(youPosition.clone().add(relativePos));
        }
      });
    }
  }

  // Pulse highlights
  highlightedNodes.forEach(nodeId => {
    if (nodeId === 'me') return;
    const node = nodeObjs.get(nodeId);
    if (!node) return;
    const pulseScale = 1 + Math.sin(t * 2) * 0.2;
    node.scale.setScalar(pulseScale);
    node.children.forEach(child => {
      if (child.userData?.isGlow) {
        const isTarget = nodeId === currentTarget;
        const glowPulse = isTarget ? 1 + Math.sin(t * 2.5) * 0.4 : 1 + Math.sin(t * 2.5) * 0.3;
        const opacityPulse = 0.5 + Math.sin(t * 1.8) * 0.3;
        child.scale.setScalar(glowPulse);
        child.material.opacity = Math.min(opacityPulse, 1.0);
        if (nodeId === currentTarget) child.material.color.setHex(0xFF7043);
        else if (currentOptimalPath.path.includes(nodeId)) child.material.color.setHex(0xffd700);
        else child.material.color.setHex(nodeId === 'me' ? 0x4CAF50 : 0x4DA6FF);
      }
    });
  });

  // Reset others
  nodeObjs.forEach((node, nodeId) => {
    if (!highlightedNodes.has(nodeId) && nodeId !== 'me') {
      node.scale.setScalar(1);
      node.children.forEach(child => {
        if (child.userData?.isGlow) {
          const originalColor = nodeId === 'me' ? 0x4CAF50 : 0x4DA6FF;
          child.material.color.setHex(originalColor);
          const originalOpacities = nodeId === 'me' ? [0.4, 0.5, 0.6] : [0.3, 0.4, 0.5];
          child.material.opacity = originalOpacities[child.userData.glowIndex] || 0.3;
          child.scale.setScalar(1);
        }
      });
    }
  });

  updateEdges();
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();

// Resize handling
window.addEventListener("resize", ()=>{
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

/* ================
 * NL CHAT WIRING
 * ================
 * Elements expected in DOM:
 *   <input id="llmInput" />
 *   <button id="llmButton">Ask</button>
 *   (optional) <div id="llmOutput"></div>
 */
const llm_search = document.getElementById('llmInput');
const llm_button = document.getElementById('llmButton');
const llm_output = document.getElementById('llmOutput');

function setLLMStatus(text) {
  if (llm_output) llm_output.textContent = text;
  else console.log('[LLM]', text);
}

/* Resolve LLM result to a node in our graph */
function resolveTargetNodeFromLLM({ target_name, target_company, keywords }) {
  if (!sample?.nodes?.length) return null;
  const hay = sample.nodes.filter(n => n.id !== 'me');
  if (!hay.length) return null;

  const norm = s => (s||'').toLowerCase().trim();

  const tn = norm(target_name);
  const tc = norm(target_company);

  // Scoring heuristic
  let best = null;
  let bestScore = -1;

  for (const n of hay) {
    let score = 0;
    const name = norm(n.name);
    const company = norm(n.company);

    if (tn) {
      if (name === tn) score += 10;
      else if (name.includes(tn)) score += 6;
      // First/last name partial matches:
      const tnParts = tn.split(/\s+/).filter(Boolean);
      let partsHit = 0;
      tnParts.forEach(p => { if (name.includes(p)) partsHit++; });
      score += Math.min(partsHit, 2); // +0..2
    }

    if (tc) {
      if (company === tc) score += 5;
      else if (company.includes(tc)) score += 3;
    }

    // Keywords bonus (if any)
    if (Array.isArray(keywords)) {
      const joined = `${name} ${company}`.toLowerCase();
      const hits = keywords.reduce((acc, k) => acc + (joined.includes(norm(k)) ? 1 : 0), 0);
      score += Math.min(hits, 3);
    }

    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }

  // Threshold: if we looked for a person name, require at least some signal.
  if (tn && bestScore < 3) return null;
  return best;
}

// ---------- OpenAI helpers ----------
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini'; // stable + supports JSON mode

async function getOpenAIKey() {
  // Prefer loading from extension storage or env injected at build time
  // e.g., const { openaiKey } = await chrome.storage.sync.get('openaiKey');
  // return openaiKey;
  return ''
}

async function chatJSON(messages, { model = OPENAI_MODEL, temperature = 0 } = {}) {
  const key = await getOpenAIKey();
  if (!key) throw new Error('Missing OpenAI API key. Store it in chrome.storage and load with getOpenAIKey().');

  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: 'json_object' }, // JSON mode
      messages
    })
  });

  let payload;
  try { payload = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    const msg = payload?.error?.message || `HTTP ${res.status}`;
    throw new Error(`[OpenAI ${model}] ${msg}`);
  }

  const text = payload?.choices?.[0]?.message?.content || '';
  // Safe parse helper
  const json = (() => {
    try { return JSON.parse(text); } catch { return null; }
  })();
  if (!json) throw new Error(`[OpenAI ${model}] Expected JSON, got: ${text.slice(0, 200)}`);
  return json;
}

// ---------- Your router/user msg builders must exist ----------
/* expected:
   const ROUTER_SYSTEM_PROMPT = `...must return {"action":"path"|"search", ...}`;
   function buildRouterUserMessage(query, knownPeople) { ... }
   function resolveTargetNodeFromLLM(obj) { ... }
   function linkedinSearchDummy({ keywords, query }) { ... }
   function setLLMStatus(s) { ... }  function toast(s) { ... }
*/

// ---------- Main handler (2 OpenAI calls) ----------
async function handleNLQuery(query) {
  if (!query || !query.trim()) return;

  // Build known-people context (cap to avoid prompt bloat)
  const knownPeople = (sample?.nodes || [])
    .slice(0, 80)
    .map(n => ({ name: n?.name || '', company: n?.company || '' }));

  // --- Call #1: ROUTER (path vs search) ---
  const routerMessages = [
    { role: 'system', content: ROUTER_SYSTEM_PROMPT },
    { role: 'user', content: buildRouterUserMessage(query, knownPeople) }
  ];

  setLLMStatus('Routing…');

  let routing;
  try {
    routing = await chatJSON(routerMessages, { model: OPENAI_MODEL, temperature: 0 });
  } catch (err) {
    console.error('[Router] error:', err);
  }

  // Fallback if router fails
  if (!routing || !routing.action) {
    const q = query.toLowerCase();
    const isPathy = /(introduce|intro|reach|to\s+talk\s+to|connect\s+me\s+to|path|route|how do i get to)/.test(q);
    routing = {
      action: isPathy ? 'path' : 'search',
      reason: 'heuristic_fallback',
      target_name: null,
      target_company: null,
      keywords: [],
      query
    };
  }

  console.log('[Router Result]', routing);
  setLLMStatus(`${routing.action.toUpperCase()}: ${routing.reason || ''}`);

  // --- Call #2: ACTION DETAILS (path OR search blueprint) ---
  let details = null;
  try {
    if (routing.action === 'path') {
      const PATH_SYSTEM_PROMPT = `
You help pick a single target person already in a LinkedIn graph.
Return STRICT JSON ONLY:
{
  "target_name": string | null,
  "target_company": string | null,
  "reason": string
}
Choose the best candidate from the provided known people list (name + optional company).
If no good match, set both target fields to null.
`.trim();

      const pathUserMsg = `
User query: "${query}"

Known people (subset):
${knownPeople.map(p => `- ${p.name}${p.company ? ' @ ' + p.company : ''}`).join('\n')}
`.trim();

      setLLMStatus('Selecting target…');
      details = await chatJSON(
        [
          { role: 'system', content: PATH_SYSTEM_PROMPT },
          { role: 'user', content: pathUserMsg }
        ],
        { model: OPENAI_MODEL, temperature: 0 }
      );
      console.log('[Path Details]', details);

    } else {
      const SEARCH_SYSTEM_PROMPT = `
You design a LinkedIn people search plan.
Return STRICT JSON ONLY:
{
  "keywords": string[],          // 1-8 concise keywords/phrases
  "companies": string[],         // 0-8 normalized company names
  "titles": string[],            // 0-8 job titles/roles
  "locations": string[],         // 0-5 city/region strings
  "seniorities": string[],       // subset of ["intern","junior","mid","senior","lead","manager","director","vp","cxo"]
  "linkedin_query": string,      // single-line boolean query (e.g., title:(PM OR "product manager") AND company:(Stripe OR Google))
  "reason": string
}
Keep values short. If a field is irrelevant, return an empty array or empty string.
`.trim();

      const searchUserMsg = `User query: "${routing.query || query}"`.trim();

      setLLMStatus('Drafting search…');
      details = await chatJSON(
        [
          { role: 'system', content: SEARCH_SYSTEM_PROMPT },
          { role: 'user', content: searchUserMsg }
        ],
        { model: OPENAI_MODEL, temperature: 0 }
      );
      console.log('[Search Details]', details);
    }
  } catch (err) {
    console.error('[Action Details] error:', err);
  }

  if (!details) details = {};

  // ----- Execute chosen action -----
  if (routing.action === 'path') {
    const merged = {
      action: 'path',
      query: routing.query || query,
      target_name: details.target_name ?? routing.target_name ?? null,
      target_company: details.target_company ?? routing.target_company ?? null,
      keywords: routing.keywords || []
    };

    const targetNode = resolveTargetNodeFromLLM(merged);
    if (targetNode) {
      toast(`Finding optimal path to ${targetNode.name}…`);
      updateOptimalPath(targetNode.id);
      setLLMStatus(`PATH → ${targetNode.name}`);
    } else {
      toast(`Couldn't find "${merged.target_name || merged.target_company || 'target'}" in your graph. Running LinkedIn search instead.`);
      const kw = merged.keywords?.length ? merged.keywords : [merged.target_name, merged.target_company].filter(Boolean);
      linkedinSearchDummy({ keywords: kw, query: merged.query });
      setLLMStatus('SEARCH (fallback) started');
    }

  } else if (routing.action === 'search') {
    const keywords = Array.isArray(details.keywords) ? details.keywords : [];
    const compiled = details.linkedin_query || (routing.query || query);
    linkedinSearchDummy({ keywords: keywords.length ? keywords : [routing.query || query], query: compiled });
    setLLMStatus('SEARCH started');

  } else {
    linkedinSearchDummy({ keywords: [], query });
    setLLMStatus('SEARCH (default) started');
  }
}


// Wire the NL button
if (llm_button && llm_search) {
  llm_button.addEventListener('click', () => handleNLQuery(llm_search.value));
  llm_search.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleNLQuery(llm_search.value); });
}

console.log('Three.js Network Visualizer loaded successfully!');
