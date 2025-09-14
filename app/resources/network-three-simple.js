// Three.js Network Visualizer for Chrome Extension
// Using bundled Three.js files to avoid CSP issues

console.log('Loading Three.js Network Visualizer...');

// Import bundled Three.js modules
import * as THREE from './three-bundle.js';
import { OrbitControls } from './orbit-controls-bundle.js';
import { CSS2DRenderer, CSS2DObject } from './css2d-renderer-bundle.js';


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
    const parsed =sample_data
    // normalize to array
    const profiles = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    if (!Array.isArray(profiles)) throw new Error('Profiles JSON is not an array');

    // helper: stable id from profile_url or index
    const toId = (p, i) => {
      if (typeof p?.profile_url === 'string' && p.profile_url.trim()) {
        // take last path segment, strip non-alphanumerics, fallback to base64 slice
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
      // Try to extract company from description (scraper format)
      if (p?.description?.trim()) {
        const desc = p.description.trim();
        // Look for patterns like "Software Engineer at Google" or "Manager @ Microsoft"
        const atMatch = desc.match(/(?:at|@)\s*([^,•]+)/i);
        if (atMatch) return atMatch[1].trim();
        // Look for patterns like "Google • Software Engineer"
        const bulletMatch = desc.match(/^([^•]+)\s*•/);
        if (bulletMatch) return bulletMatch[1].trim();
      }
      return 'Unknown';
    };

    // helper: extract school from education or location
    const toSchool = (p) => {
      if (Array.isArray(p?.education) && p.education.length > 0) {
        return p.education[0]?.school?.trim() || 'Unknown';
      }
      // Try to extract school from description
      if (p?.description?.trim()) {
        const desc = p.description.trim();
        const schoolMatch = desc.match(/(?:university|college|institute|school)\s+of\s+([^,•]+)/i);
        if (schoolMatch) return schoolMatch[1].trim();
      }
      return 'Unknown';
    };

    // helper: extract role from current_title, title, or scraper description
    const toRole = (p) => {
      if (p?.current_title?.trim()) return p.current_title.trim();
      if (p?.title?.trim()) return p.title.trim();
      // Try to extract role from description (scraper format)
      if (p?.description?.trim()) {
        const desc = p.description.trim();
        // Look for patterns like "Software Engineer at Google"
        const roleMatch = desc.match(/^([^@•]+?)(?:\s+at\s+|\s*•)/i);
        if (roleMatch) return roleMatch[1].trim();
      }
      return 'Unknown';
    };

    // helper: extract profile picture URL from various possible fields
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
      const profilePic = toProfilePic(p);
      
      // Filter out profiles with no name or invalid names
      if (!name || name === 'Unknown' || name.trim() === '' || name.length < 2) {
        console.log(`Filtering out dud profile ${i}: no valid name (${name})`);
        return false;
      }
      
      // Filter out profiles with invalid IDs
      if (!id || id.length < 2) {
        console.log(`Filtering out dud profile ${i}: no valid ID (${id})`);
        return false;
      }
      
      // Filter out profiles that are just empty objects or have no meaningful data
      if (!p || typeof p !== 'object' || Object.keys(p).length === 0) {
        console.log(`Filtering out dud profile ${i}: empty object`);
        return false;
      }
      
      // Filter out profiles with suspiciously short or repetitive names
      if (name.length < 3 || name === name.charAt(0).repeat(name.length)) {
        console.log(`Filtering out dud profile ${i}: suspicious name (${name})`);
        return false;
      }
      
      return true;
    });
    
    // Deduplicate profiles by ID to prevent duplicate nodes
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
        profilePic: 'https://media.licdn.com/dms/image/v2/D5603AQGqDoohcUjKyA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1714183463744?e=1760572800&v=beta&t=LRkqPiohCLRDP9tCtgxYqvzYe_TqWdfiWkvcuJonfNM',
        profileUrl: null // You node doesn't have a profile URL
      }
    ];
    
    // Add unique profiles and ensure no duplicate IDs
    const usedIds = new Set(['me']); // Start with 'me' ID
    
    uniqueProfiles.forEach((p, i) => {
      let nodeId = toId(p, i);
      let counter = 1;
      
      // Ensure unique ID by adding counter if needed
      while (usedIds.has(nodeId)) {
        nodeId = toId(p, i) + counter;
        counter++;
      }
      usedIds.add(nodeId);
      
      const node = {
        id: nodeId,
        name: toName(p),
        degree: 1, // All scraped profiles are first-degree connections
        company: toCompany(p),
        school: toSchool(p),
        role: toRole(p),
        profilePic: toProfilePic(p),
        profileUrl: p?.profile_url?.trim() || null // Store LinkedIn profile URL
      };
      
      nodes.push(node);
      console.log(`Processed unique profile ${i}:`, node);
    });

    // build edges array (simplified - in real implementation, this would come from connection data)
    const edges = [];
    // Connect "You" node to scraped profiles
    if (nodes.length > 1) {
      console.log(`Creating edges for ${nodes.length - 1} scraped profiles...`);
      
      // Connect "You" node to all valid scraped profiles
      for (let i = 1; i < nodes.length; i++) {
        const targetNode = nodes[i];
        console.log(`Processing node ${i}:`, targetNode);
        
        // Create edge for ALL scraped profiles (they're already filtered)
        if (targetNode && targetNode.id) {
          edges.push({
            source: 'me', // connect to "You" node
            target: targetNode.id,
            weight: Math.random() * 0.5 + 0.3, // random weight between 0.3-0.8
            reasons: ['Scraped connection']
          });
          console.log(`✅ Created edge: You -> ${targetNode.name || 'Unknown'} (${targetNode.id})`);
        } else {
          console.log(`❌ Skipped creating edge for invalid node:`, targetNode);
        }
      }
      
      console.log(`Total edges created: ${edges.length}`);
    }

    // Safety check: ensure all non-"me" nodes have edges
    const connectedNodeIds = new Set();
    edges.forEach(edge => {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    });
    
    const orphanedNodes = nodes.filter(node => 
      node.id !== 'me' && !connectedNodeIds.has(node.id)
    );
    
    if (orphanedNodes.length > 0) {
      console.warn(`Found ${orphanedNodes.length} orphaned nodes:`, orphanedNodes);
      // Add edges for orphaned nodes
      orphanedNodes.forEach(node => {
        edges.push({
          source: 'me',
          target: node.id,
          weight: 0.5,
          reasons: ['Orphaned node connection']
        });
        console.log(`🔗 Added missing edge for orphaned node: You -> ${node.name} (${node.id})`);
      });
    }

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
let currentMultiplePaths = { paths: [], allEdges: new Set(), companyName: '' };
let currentTarget = null;
let highlightedNodes = new Set();
let is3DMode = true; // Track current view mode
let frozenZPositions = new Map(); // Store Z positions when in 2D mode
let hoveredNode = null;
let hoveredNodeOriginalScale = null;
// Network rotation disabled - no rotation speed needed

// Clear any existing nodes to prevent duplicates
nodeGroup.clear();
nodeObjs.clear();
nodeAnimations.clear();

// Create nodes
sample.nodes.forEach((n, idx) => {
  // Check if node already exists to prevent duplicates
  if (nodeObjs.has(n.id)) {
    console.warn(`Skipping duplicate node creation for ID: ${n.id}`);
    return;
  }
  
  // Create glowing node group
  const glowNode = new THREE.Group();
  
  // Determine node color based on semantic color scheme
  let nodeColor;
  if (n.id === 'me') {
    nodeColor = 0x4CAF50; // Bright green for user node
  } else {
    nodeColor = 0x4DA6FF; // Medium blue for 1st-degree connections
  }
  
  // Declare glow variables outside the if block
  let outerGlow = null;
  let innerGlow = null;
  
  // Outer glow sphere (only if no profile picture)
  if (!n.profilePic) {
    const glowSize = n.id === 'me' ? 24 : 18;
    outerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(glowSize, 16, 12),
      new THREE.MeshBasicMaterial({ 
        color: nodeColor,
        transparent: true,
        opacity: n.id === 'me' ? 0.3 : 0.2, // More visible glow
        side: THREE.BackSide,
        blending: THREE.NormalBlending, // Normal blending for true color visibility
        fog: false // Disable fog for cleaner glow
      })
    );
    glowNode.add(outerGlow);
    
    // Inner glow sphere (only if no profile picture)
    const innerGlowSize = n.id === 'me' ? 15 : 12;
    innerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(innerGlowSize, 16, 12),
      new THREE.MeshBasicMaterial({ 
        color: nodeColor,
        transparent: true,
        opacity: n.id === 'me' ? 0.4 : 0.3, // More visible glow
        blending: THREE.NormalBlending, // Normal blending for true color visibility
        fog: false // Disable fog for cleaner glow
      })
    );
    glowNode.add(innerGlow);
  }
  
  let core;

  if (n.profilePic) {
    // Create texture from profile picture
    const loader = new THREE.TextureLoader();
    console.log(`Attempting to load profile picture for ${n.name}: ${n.profilePic}`);

    // Load texture synchronously first
    try {
      const profileTexture = loader.load(n.profilePic);
      console.log(`✅ Profile picture loaded for ${n.name}`);

      // Create a circular node with profile picture texture that always faces the camera
      const nodeSize = n.id === 'me' ? 30 : 24;
      const nodeGeometry = new THREE.CircleGeometry(nodeSize/2, 32);
      
      // Add some depth by displacing vertices slightly to create a subtle dome
      const vertices = nodeGeometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i);
        const y = vertices.getY(i);
        const z = vertices.getZ(i);
        
        // Create a subtle dome effect by displacing Z based on distance from center
        const distanceFromCenter = Math.sqrt(x * x + y * y);
        const maxDistance = nodeSize / 2;
        const normalizedDistance = Math.min(distanceFromCenter / maxDistance, 1);
        
        // Create a subtle curve - more pronounced at edges
        const curveHeight = Math.cos(normalizedDistance * Math.PI / 2) * 1.5;
        vertices.setZ(i, curveHeight);
      }
      vertices.needsUpdate = true;
      
      const nodeMaterial = new THREE.MeshBasicMaterial({
        map: profileTexture,
        color: 0xffffff, // White to show texture clearly without color distortion
        transparent: false, // Make opaque so it can occlude edges
        opacity: 1.0,
        side: THREE.DoubleSide,
        depthWrite: true,  // Write to depth buffer
        depthTest: true,   // Test depth
        alphaTest: 0.5,    // Higher threshold for more solid appearance
        emissive: 0x000000, // No emissive glow
        emissiveIntensity: 0, // No emissive intensity
        roughness: 0.0,    // Make it more solid/smooth
        metalness: 0.0,    // Non-metallic for solid appearance
        flatShading: false, // Smooth shading for solid look
        vertexColors: false // Use material color instead of vertex colors
      });

      core = new THREE.Mesh(nodeGeometry, nodeMaterial);
      core.material.depthWrite = true;
      core.material.depthTest = true;
      core.material.transparent = false; // Ensure solid occlusion
      core.material.opacity = 1.0; // Ensure full opacity
      core.renderOrder = 10; // Profile picture renders on top of glows
      
      // Add multiple glow layers around profile picture for better color effect
      console.log(`Creating glows for node ${n.id} with profile picture`);
      const profileRadius = nodeSize/2; // Radius of the profile picture
      const glowSizes = n.id === 'me' ? [profileRadius + 3, profileRadius + 6, profileRadius + 9] : [profileRadius + 2, profileRadius + 4, profileRadius + 6]; // Glows just outside profile
      const glowOpacities = n.id === 'me' ? [0.4, 0.5, 0.6] : [0.3, 0.4, 0.5];
      
      glowSizes.forEach((glowSize, index) => {
        // Create a ring geometry that goes around the profile picture
        const innerRadius = profileRadius + 1; // Start just outside the profile picture
        const outerRadius = glowSize; // End at the glow size
        const glowGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: nodeColor,
          transparent: false, // Make opaque for testing
          opacity: 1.0, // Full opacity for testing
          side: THREE.DoubleSide,
          depthWrite: true, // Write to depth buffer for proper layering
          depthTest: true,  // Test depth for proper layering
          blending: THREE.NormalBlending, // Normal blending for true color visibility
          fog: false // Disable fog for cleaner glow
        });
        
        // Debug logging for glow color
        if (n.id !== 'me') {
          console.log(`Creating glow for node ${n.id}: color=${nodeColor.toString(16)}, opacity=${glowOpacities[index]}`);
        }
        
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.position.z = -0.1 - (index * 0.05); // Just behind the profile picture
        glow.renderOrder = 1; // Glow renders behind profile picture but above edges
        glow.userData.isGlow = true;
        glow.userData.isBillboard = true; // Make glow also billboard
        glow.userData.glowIndex = index;
        
        // Force set the color after creation
        glow.material.color.setHex(nodeColor);
        console.log(`Set glow color to ${nodeColor.toString(16)} for node ${n.id}`);
        
        glowNode.add(glow);
        console.log(`Added glow ${index} to node ${n.id}, glowNode children count: ${glowNode.children.length}`);
      });
      
      // Make the circular node always face the camera by updating its rotation in the animation loop
      core.userData.isBillboard = true;
      
    } catch (error) {
      console.error(`❌ Failed to load profile picture for ${n.name}:`, error);
      // Fallback to solid color sphere
      const coreSize = n.id === 'me' ? 8 : 6;
      const coreGeometry = new THREE.SphereGeometry(coreSize, 16, 12);
      const coreMaterial = new THREE.MeshBasicMaterial({
        color: nodeColor,
        transparent: true,
        opacity: 0.8
      });
      core = new THREE.Mesh(coreGeometry, coreMaterial);
    }
  } else {
    // Fallback to solid color sphere
    const coreSize = n.id === 'me' ? 8 : 6;
    const coreGeometry = new THREE.SphereGeometry(coreSize, 16, 12);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: nodeColor,
      transparent: true,
      opacity: 0.8
    });
    core = new THREE.Mesh(coreGeometry, coreMaterial);
  }

  glowNode.add(core);
  
  // Layout nodes in 3D space with 'me' at center
  if (n.id === 'me') {
    glowNode.position.set(0, 0, 0);
  } else {
    // Use spherical coordinates for 3D distribution
    const phi = Math.acos(2 * Math.random() - 1); // Random polar angle (0 to π)
    const theta = 2 * Math.PI * Math.random(); // Random azimuthal angle (0 to 2π)
    const radius = 120 + Math.random() * 120; // Random radius between 120 and 240
    
    // Convert spherical to Cartesian coordinates
    glowNode.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi)
    );
  }
  glowNode.renderOrder = 10; // Render nodes well above edges
  nodeGroup.add(glowNode);
  nodeObjs.set(n.id, glowNode);
  
  // Debug: Log glow node info
  console.log(`Node ${n.id}: glowNode children count: ${glowNode.children.length}, position:`, glowNode.position);
  glowNode.children.forEach((child, index) => {
    if (child.userData.isGlow) {
      console.log(`  Glow ${index}: visible=${child.visible}, position=${child.position}, color=${child.material.color.getHexString()}`);
    }
  });

  // Create detailed label with name and company (hidden by default)
  const labelDiv = document.createElement("div");
  labelDiv.className = "tooltip";
  
  // Format: "Firstname Lastname, Role @ Company" or just "Name" if company/role are Unknown
  let labelText = n.name;
  
  // For "You" node, just show "You"
  if (n.id === 'me') {
    labelText = 'You';
  } else {
    // For other nodes, show name and company/role if they're not "Unknown"
    if (n.role && n.role !== 'Unknown' && n.company && n.company !== 'Unknown') {
      labelText += `, ${n.role} @ ${n.company}`;
    } else if (n.company && n.company !== 'Unknown') {
      labelText += ` @ ${n.company}`;
    } else if (n.role && n.role !== 'Unknown') {
      labelText += `, ${n.role}`;
    }
    // If everything is "Unknown", just show the name
  }
  
  labelDiv.textContent = labelText;
  
  // Show "You" node label by default, hide others
  if (n.id === 'me') {
    labelDiv.style.display = 'block';
    labelDiv.style.visibility = 'visible';
    labelDiv.style.opacity = '1';
  } else {
    labelDiv.style.display = 'none'; // Hidden by default, shown on hover
    labelDiv.style.visibility = 'hidden'; // Double ensure it's hidden
    labelDiv.style.opacity = '0'; // Make it completely invisible
  }
  
  const label = new CSS2DObject(labelDiv);
  label.position.set(0, -15, 0); // Position below the node
  glowNode.add(label);
  
  // Store reference to label for hover effects
  glowNode.userData = { 
    nodeId: n.id, 
    label: labelDiv,
    originalScale: 1,
    profileUrl: n.profileUrl // Store LinkedIn profile URL for double-click
  };

  nodeAnimations.set(n.id, {
    originalPos: glowNode.position.clone(),
    timeOffset: Math.random()*Math.PI*2,
    amplitude: 2 + Math.random()*3,
    frequency: 0.5 + Math.random()*0.5,
    scaleAmplitude: 0.1 + Math.random()*0.1,
    scaleFrequency: 0.3 + Math.random()*0.4,
    glowNode: glowNode,
    outerGlow: outerGlow, // null if no profile picture
    innerGlow: innerGlow, // null if no profile picture
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
  
  // Default edge color - light gray at 60% opacity
  const color = 0x9aa7c6;
  const opacity = 0.6;
  const linewidth = 3;
  
  const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ 
    color: color, 
    transparent: true, 
    opacity: opacity,
    depthTest: true,
    depthWrite: true,
    alphaTest: 0.1
  }));
  line.renderOrder = -10; // Render edges well behind nodes
  line.material.depthWrite = true;
  line.material.depthTest = true;
  line.material.transparent = true; // Keep edges transparent
  line.material.opacity = 0.6; // Ensure proper opacity
  edgeGroup.add(line);
  edgeLines.set(`${e.source}-${e.target}`, line);
});

// Zoom in on optimal path nodes
function zoomToOptimalPath() {
  if (!currentOptimalPath || currentOptimalPath.path.length === 0) return;
  
  // Get all nodes in the optimal path
  const pathNodes = currentOptimalPath.path.map(nodeId => nodeObjs.get(nodeId)).filter(node => node);
  
  if (pathNodes.length === 0) return;
  
  // Calculate bounding box of optimal path nodes
  const box = new THREE.Box3();
  pathNodes.forEach(node => box.expandByObject(node));
  
  // Get center and size of the bounding box
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  // Calculate distance needed to fit the bounding box in view
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2; // Add some padding
  
  // Calculate new camera position
  const direction = new THREE.Vector3().subVectors(camera.position, center).normalize();
  const newPosition = center.clone().add(direction.multiplyScalar(distance));
  
  // Animate camera to new position
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const newTarget = center.clone();
  
  let progress = 0;
  const duration = 1000; // 1 second animation
  const startTime = performance.now();
  
  function animateCamera() {
    const elapsed = performance.now() - startTime;
    progress = Math.min(elapsed / duration, 1);
    
    // Easing function for smooth animation
    const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const easedProgress = easeInOutCubic(progress);
    
    // Interpolate camera position and target
    camera.position.lerpVectors(startPosition, newPosition, easedProgress);
    controls.target.lerpVectors(startTarget, newTarget, easedProgress);
    controls.update();
    
    if (progress < 1) {
      requestAnimationFrame(animateCamera);
    }
  }
  
  animateCamera();
}

// Zoom in on multiple optimal paths
function zoomToMultiplePaths() {
  if (!currentMultiplePaths || currentMultiplePaths.paths.length === 0) return;
  
  // Get all nodes in all paths
  const allPathNodes = new Set();
  currentMultiplePaths.paths.forEach(pathData => {
    pathData.path.forEach(nodeId => allPathNodes.add(nodeId));
  });
  
  const pathNodes = Array.from(allPathNodes).map(nodeId => nodeObjs.get(nodeId)).filter(node => node);
  
  if (pathNodes.length === 0) return;
  
  // Calculate bounding box for all path nodes
  const box = new THREE.Box3().setFromPoints(pathNodes.map(node => node.position));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2;
  
  // Animate camera to focus on the paths
  const targetPosition = center.clone();
  targetPosition.z += distance;
  
  // Store original camera position for smooth animation
  const originalPosition = camera.position.clone();
  const originalTarget = controls.target.clone();
  
  // Animate camera movement
  const startTime = Date.now();
  const duration = 1000; // 1 second animation
  
  function animateCamera() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic
    
    camera.position.lerpVectors(originalPosition, targetPosition, easeProgress);
    controls.target.lerpVectors(originalTarget, center, easeProgress);
    controls.update();
    
    if (progress < 1) {
      requestAnimationFrame(animateCamera);
    }
  }
  
  animateCamera();
}

// Zoom in on a specific path from multiple paths
function zoomToSpecificPath(pathIndex) {
  if (!currentMultiplePaths || !currentMultiplePaths.paths[pathIndex]) return;
  
  const pathData = currentMultiplePaths.paths[pathIndex];
  const pathNodes = pathData.path.map(nodeId => nodeObjs.get(nodeId)).filter(node => node);
  
  if (pathNodes.length === 0) return;
  
  // Calculate bounding box for this specific path
  const box = new THREE.Box3().setFromPoints(pathNodes.map(node => node.position));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2;
  
  // Animate camera to focus on this specific path
  const targetPosition = center.clone();
  targetPosition.z += distance;
  
  // Store original camera position for smooth animation
  const originalPosition = camera.position.clone();
  const originalTarget = controls.target.clone();
  
  // Animate camera movement
  const startTime = Date.now();
  const duration = 1000; // 1 second animation
  
  function animateCamera() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic
    
    camera.position.lerpVectors(originalPosition, targetPosition, easeProgress);
    controls.target.lerpVectors(originalTarget, center, easeProgress);
    controls.update();
    
    if (progress < 1) {
      requestAnimationFrame(animateCamera);
    }
  }
  
  animateCamera();
}

// Find optimal path from 'me' to a specific target node
function findOptimalPathToTarget(targetId) {
  if (targetId === 'me') return { edges: new Set(), path: ['me'] };
  
  const visited = new Set();
  const queue = [{node: 'me', path: ['me'], weight: 0}];
  
  while (queue.length > 0) {
    const {node, path, weight} = queue.shift();
    
    if (node === targetId) {
      // Reconstruct path
      const optimalEdges = new Set();
      for (let i = 0; i < path.length - 1; i++) {
        optimalEdges.add(`${path[i]}-${path[i + 1]}`);
      }
      return { edges: optimalEdges, path: path };
    }
    
    if (visited.has(node)) continue;
    visited.add(node);
    
    // Find all edges from current node
    const outgoingEdges = sample.edges.filter(e => e.source === node && !visited.has(e.target));
    
    for (const edge of outgoingEdges) {
      const newWeight = weight + edge.weight;
      queue.push({
        node: edge.target,
        path: [...path, edge.target],
        weight: newWeight
      });
    }
    
    // Sort by total weight (highest first for better path)
    queue.sort((a, b) => b.weight - a.weight);
  }
  
  return { edges: new Set(), path: [] };
}

// Find all optimal paths to a company (multiple people at same company)
function findAllOptimalPathsToCompany(companyName) {
  // Find all nodes that work at this company
  const companyNodes = sample.nodes.filter(node => 
    node.company && node.company.toLowerCase().includes(companyName.toLowerCase())
  );
  
  if (companyNodes.length === 0) {
    return { paths: [], allEdges: new Set() };
  }
  
  const allPaths = [];
  const allEdges = new Set();
  
  // Find optimal path to each person at the company
  companyNodes.forEach(targetNode => {
    const path = findOptimalPathToTarget(targetNode.id);
    if (path.path.length > 0) {
      allPaths.push({
        targetId: targetNode.id,
        targetName: targetNode.name,
        path: path.path,
        edges: path.edges,
        weight: path.weight || 0
      });
      
      // Add edges to the combined set
      path.edges.forEach(edge => allEdges.add(edge));
    }
  });
  
  // Sort paths by weight (best paths first)
  allPaths.sort((a, b) => b.weight - a.weight);
  
  return { paths: allPaths, allEdges: allEdges };
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
  
  const originalColor = nodeId === 'me' ? 0x4CAF50 : 0x4DA6FF; // Blue for 1st-degree connections
  
  if (highlightType === 'target') {
    // Target node - vivid orange
    console.log(`Highlighting target node ${nodeId} with orange color`);
    highlightedNodes.add(nodeId);
    node.children.forEach(child => {
      if (child.material) {
        if (child.userData.isBillboard) {
          // Apply orange tint to profile picture
          child.material.color.setHex(0xFF7043);
          child.material.opacity = 0.8; // Slightly transparent to show the orange tint
        } else if (child.userData.isGlow) {
          // For glow effects, make them more prominent with orange
          child.material.color.setHex(0xFF7043);
          child.material.opacity = Math.min(child.material.opacity * 2.5, 1.0); // Much brighter, cap at 1.0
        } else {
          child.material.color.setHex(0xFF7043); // Vivid orange
        }
      }
    });
    
    // Add subtle glow effect for optimal path
    if (node.userData && node.userData.glowNode) {
      node.userData.glowNode.children.forEach(child => {
        if (child.material && child.material.emissive) {
          child.material.emissive.setHex(0x331100); // Subtle orange glow
          child.material.emissiveIntensity = 0.3;
        }
      });
    }
    
    // Make the target node's label permanently visible
    if (node.userData && node.userData.label) {
      node.userData.label.style.display = 'block';
      node.userData.label.style.visibility = 'visible';
      node.userData.label.style.opacity = '1';
    }
  } else if (highlightType === 'intermediate') {
    // Intermediate node - yellow
    console.log(`Highlighting intermediate node ${nodeId} with yellow color`);
    highlightedNodes.add(nodeId);
    node.children.forEach(child => {
      if (child.material) {
        if (child.userData.isBillboard) {
          // Apply yellow tint to profile picture
          child.material.color.setHex(0xffd700);
          child.material.opacity = 0.8; // Slightly transparent to show the yellow tint
        } else if (child.userData.isGlow) {
          // For glow effects, make them more prominent with yellow
          child.material.color.setHex(0xffd700);
          child.material.opacity = Math.min(child.material.opacity * 2.5, 1.0); // Much brighter, cap at 1.0
        } else {
          child.material.color.setHex(0xffd700); // Gold/yellow
        }
      }
    });
    
    // Add subtle glow effect for optimal path
    if (node.userData && node.userData.glowNode) {
      node.userData.glowNode.children.forEach(child => {
        if (child.material && child.material.emissive) {
          child.material.emissive.setHex(0x332200); // Subtle yellow glow
          child.material.emissiveIntensity = 0.2;
        }
      });
    }
  } else {
    // Clear highlighting
    console.log(`Clearing highlighting for node ${nodeId}, restoring to original color: ${originalColor.toString(16)}`);
    highlightedNodes.delete(nodeId);
    node.children.forEach(child => {
      if (child.material) {
        if (child.userData.isBillboard) {
          // Reset profile picture to original color (no tint)
          child.material.color.setHex(0xffffff); // White for no tint
          child.material.opacity = 1.0; // Full opacity
        } else if (child.userData.isGlow) {
          // For glow effects, restore original color and opacity
          child.material.color.setHex(originalColor);
          // Restore original opacity based on glow layer
          const originalOpacities = nodeId === 'me' ? [0.4, 0.5, 0.6] : [0.3, 0.4, 0.5];
          child.material.opacity = originalOpacities[child.userData.glowIndex] || 0.3;
        } else {
          child.material.color.setHex(originalColor);
        }
      }
    });
    
    // Reset glow effect
    if (node.userData && node.userData.glowNode) {
      node.userData.glowNode.children.forEach(child => {
        if (child.material && child.material.emissive) {
          child.material.emissive.setHex(0x000000); // Reset glow
          child.material.emissiveIntensity = 0;
        }
      });
    }
  }
}

function updateOptimalPath(targetId) {
  // Hide the previous target's label if it exists and is not 'me'
  if (currentTarget && currentTarget !== 'me') {
    const previousTargetNode = nodeObjs.get(currentTarget);
    if (previousTargetNode && previousTargetNode.userData && previousTargetNode.userData.label) {
      previousTargetNode.userData.label.style.display = 'none';
      previousTargetNode.userData.label.style.visibility = 'hidden';
      previousTargetNode.userData.label.style.opacity = '0';
    }
  }
  
  // Clear previous highlights
  console.log(`Clearing previous highlights for single path. Highlighted nodes:`, Array.from(highlightedNodes));
  highlightedNodes.forEach(nodeId => highlightNode(nodeId, 'none'));
  highlightedNodes.clear();
  
  // Clear multiple paths state when switching to single path
  currentMultiplePaths = null;
  
  // Clear any existing optimal path cylinders from previous multiple paths
  edgeGroup.children.forEach(child => {
    if (child.userData && child.userData.isOptimalEdge) {
      edgeGroup.remove(child);
    }
  });
  
  // Clear hidden nodes to ensure all nodes are visible
  hiddenNodes.forEach(nodeId => {
    const node = nodeObjs.get(nodeId);
    if (node) {
      node.visible = true;
    }
  });
  hiddenNodes.clear();
  
  currentTarget = targetId;
  currentOptimalPath = findOptimalPathToTarget(targetId);
  
  // Highlight nodes in the optimal path with different colors
  currentOptimalPath.path.forEach((nodeId, index) => {
    if (nodeId !== 'me') { // Don't highlight the 'me' node
      if (nodeId === targetId) {
        // Target node - bright orange
        console.log(`Single path: highlighting target ${nodeId} as orange`);
        highlightNode(nodeId, 'target');
      } else {
        // Intermediate node - yellow
        console.log(`Single path: highlighting intermediate ${nodeId} as yellow`);
        highlightNode(nodeId, 'intermediate');
      }
    }
  });
  
  // Update edge colors and create thick cylinders for optimal path
  sample.edges.forEach(e => {
    const line = edgeLines.get(`${e.source}-${e.target}`);
    if (!line) return;
    
    const isOptimal = currentOptimalPath.edges.has(`${e.source}-${e.target}`);
    
    if (isOptimal) {
      // Hide the original line and create a thick cylinder
      line.visible = false;
      
      // Create thick cylinder for optimal path
      const s = nodeObjs.get(e.source);
      const t = nodeObjs.get(e.target);
      if (s && t) {
        const direction = new THREE.Vector3().subVectors(t.position, s.position);
        const length = direction.length();
        const midpoint = new THREE.Vector3().addVectors(s.position, t.position).multiplyScalar(0.5);
        
        const cylinderGeometry = new THREE.CylinderGeometry(0.6, 0.6, length, 8);
        const cylinderMaterial = new THREE.MeshBasicMaterial({
          color: 0xffd700, // Yellow for highlighted path edges
          transparent: true,
          opacity: 0.9
        });
        
        const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
        cylinder.position.copy(midpoint);
        cylinder.lookAt(t.position);
        cylinder.rotateX(Math.PI / 2);
        cylinder.renderOrder = -5; // Render cylinders behind nodes but above regular edges
        
        // Store reference to remove later
        cylinder.userData = { isOptimalEdge: true, edgeKey: `${e.source}-${e.target}` };
        edgeGroup.add(cylinder);
      }
    } else {
      // Show the original line and remove any existing cylinder
      line.visible = true;
      
      // Remove any existing optimal path cylinder for this edge
      edgeGroup.children.forEach(child => {
        if (child.userData && child.userData.isOptimalEdge && child.userData.edgeKey === `${e.source}-${e.target}`) {
          edgeGroup.remove(child);
        }
      });
      
      // Restore original strength-based colors
      let color, opacity;
      if (e.weight >= 0.7) {
        color = 0x4da6ff; // Bright blue
        opacity = 0.9;
      } else if (e.weight >= 0.5) {
        color = 0x6b9bd2; // Medium blue
        opacity = 0.8;
      } else {
        color = 0x9aa7c6; // Gray
        opacity = 0.6;
      }
      console.log(`Single path: Resetting edge ${e.source}-${e.target} to color ${color.toString(16)}`);
      line.material.color.setHex(color);
      line.material.opacity = opacity;
    }
  });
  
  // Update edges to show the new optimal path
  updateEdges();
  
  // Update sidebar info
  updateSidebarInfo();
  
  // If path-only mode is active, update the visible nodes
  if (isPathOnlyMode) {
    showOnlyOptimalPathNodes();
  }
}

// Update multiple optimal paths for a company
function updateMultipleOptimalPaths(companyName, companyNodes) {
  // Clear previous highlights
  console.log(`Clearing previous highlights for multiple paths. Highlighted nodes:`, Array.from(highlightedNodes));
  highlightedNodes.forEach(nodeId => highlightNode(nodeId, 'none'));
  highlightedNodes.clear();
  
  // Clear hidden nodes to ensure all nodes are visible
  hiddenNodes.forEach(nodeId => {
    const node = nodeObjs.get(nodeId);
    if (node) {
      node.visible = true;
    }
  });
  hiddenNodes.clear();
  
  // Reset all edges to original colors before applying multiple path highlighting
  edgeLines.forEach((line, edgeKey) => {
    line.visible = true;
    const [sourceId, targetId] = edgeKey.split('-');
    
    // Determine original edge color based on connection type
    let color, opacity;
    if (sourceId === 'me' || targetId === 'me') {
      // 1st-degree connection - medium blue
      color = 0x6b9bd2;
      opacity = 0.8;
    } else {
      // Regular connection - light gray
      color = 0x9aa7c6;
      opacity = 0.6;
    }
    
    line.material.color.setHex(color);
    line.material.opacity = opacity;
  });
  
  // Clear any existing optimal path cylinders
  edgeGroup.children.forEach(child => {
    if (child.userData && child.userData.isOptimalEdge) {
      edgeGroup.remove(child);
    }
  });
  
  // Find all optimal paths to the company
  const multiplePaths = findAllOptimalPathsToCompany(companyName);
  
  currentTarget = null; // No single target for multiple paths
  currentOptimalPath = { edges: new Set(), path: [] };
  currentMultiplePaths = {
    paths: multiplePaths.paths,
    allEdges: multiplePaths.allEdges,
    companyName: companyName
  };
  
  // Highlight all nodes in all paths with proper color coding
  multiplePaths.paths.forEach((pathData, pathIndex) => {
    pathData.path.forEach((nodeId, nodeIndex) => {
      if (nodeId !== 'me') {
        if (nodeId === pathData.targetId) {
          // Target node - bright orange
          console.log(`Multiple paths: highlighting target ${nodeId} as orange`);
          highlightNode(nodeId, 'target');
        } else {
          // Intermediate node - yellow
          console.log(`Multiple paths: highlighting intermediate ${nodeId} as yellow`);
          highlightNode(nodeId, 'intermediate');
        }
      }
    });
  });
  
  // For multiple paths, make only target node edges yellow
  console.log('Multiple paths: Making target node edges yellow');
  sample.edges.forEach(e => {
    const line = edgeLines.get(`${e.source}-${e.target}`);
    if (!line) return;
    
    // Check if this edge connects to a target node
    const isTargetEdge = multiplePaths.paths.some(pathData => 
      pathData.targetId === e.source || pathData.targetId === e.target
    );
    
    if (isTargetEdge) {
      // Make target node edges yellow
      line.visible = true;
      line.material.color.setHex(0xffd700); // Yellow for target edges
      line.material.opacity = 0.8;
    } else {
      // Keep other edges at original colors
      line.visible = true;
      // Restore original strength-based colors
      let color, opacity;
      if (e.weight >= 0.7) {
        color = 0x4da6ff; // Bright blue
        opacity = 0.9;
      } else if (e.weight >= 0.5) {
        color = 0x6b9bd2; // Medium blue
        opacity = 0.8;
      } else {
        color = 0x9aa7c6; // Gray
        opacity = 0.6;
      }
      line.material.color.setHex(color);
      line.material.opacity = opacity;
    }
  });
  
  // Update sidebar info
  updateMultiplePathsSidebarInfo();
  
  // If path-only mode is active, update the visible nodes
  if (isPathOnlyMode) {
    showOnlyMultiplePathsNodes();
  }
}

function updateSidebarInfo() {
  const optimalPathDiv = document.querySelector('.optimal-path-info');
  if (!optimalPathDiv) return;
  
  if (!currentTarget || currentOptimalPath.path.length === 0) {
    optimalPathDiv.style.display = 'none';
    return;
  }
  
  const targetNode = sample.nodes.find(n => n.id === currentTarget);
  const pathNames = currentOptimalPath.path.map(id => {
    const node = sample.nodes.find(n => n.id === id);
    return node ? node.name : id;
  });
  
  optimalPathDiv.style.display = 'block';
  optimalPathDiv.innerHTML = `
    <strong>Optimal Path to ${targetNode ? targetNode.name : 'Target'}:</strong><br>
    ${pathNames.join(' → ')}<br>
    <em style="color: #FFD700; cursor: pointer; text-decoration: underline;">Click to zoom in on path</em>
  `;
  
  // Add click event listener for zoom functionality
  optimalPathDiv.style.cursor = 'pointer';
  optimalPathDiv.onclick = zoomToOptimalPath;
}

// Update sidebar info for multiple paths
function updateMultiplePathsSidebarInfo() {
  const optimalPathDiv = document.querySelector('.optimal-path-info');
  if (!optimalPathDiv) return;
  
  if (!currentMultiplePaths || currentMultiplePaths.paths.length === 0) {
    optimalPathDiv.style.display = 'none';
    return;
  }
  
  const pathNames = currentMultiplePaths.paths.map((pathData, index) => {
    const pathNodeNames = pathData.path.map(id => {
      const node = sample.nodes.find(n => n.id === id);
      return node ? node.name : id;
    });
    return `<span class="clickable-path" data-path-index="${index}" style="color: #FFD700; cursor: pointer; text-decoration: underline; display: block; margin: 4px 0; padding: 2px 4px; border-radius: 4px; background: rgba(255,215,0,0.1);">${pathNodeNames.join(' → ')} (${pathData.targetName})</span>`;
  });
  
  optimalPathDiv.style.display = 'block';
  optimalPathDiv.innerHTML = `
    <strong>Optimal Paths to ${currentMultiplePaths.companyName}:</strong><br>
    ${pathNames.join('')}
  `;
  
  // Add click event listeners for individual path zooming
  optimalPathDiv.querySelectorAll('.clickable-path').forEach((pathElement, index) => {
    pathElement.addEventListener('click', () => zoomToSpecificPath(index));
  });
}

// Hover effect functions
function applyHoverEffect(node) {
  if (!node.userData) return;
  
  // Store original scales of visual elements
  hoveredNodeOriginalScale = {};
  
  // Scale only the visual elements inside the group, not the group itself
  node.children.forEach(child => {
    if (child.userData.isGlow || child.userData.isCore) {
      hoveredNodeOriginalScale[child.uuid] = child.scale.clone();
      child.scale.multiplyScalar(1.3);
    }
  });
  
  // Show the label
  if (node.userData.label) {
    node.userData.label.style.display = 'block';
    node.userData.label.style.visibility = 'visible';
    node.userData.label.style.opacity = '1';
  }
  
  // Change cursor
  renderer.domElement.style.cursor = 'pointer';
}

function resetHoverEffect(node) {
  if (!node.userData) return;
  
  // Reset scales of visual elements
  if (hoveredNodeOriginalScale && typeof hoveredNodeOriginalScale === 'object') {
    node.children.forEach(child => {
      if (child.userData.isGlow || child.userData.isCore) {
        if (hoveredNodeOriginalScale[child.uuid]) {
          child.scale.copy(hoveredNodeOriginalScale[child.uuid]);
        }
      }
    });
  }
  
  // Hide the label (but never hide the "You" node label or current target node)
  if (node.userData.label && node.userData.nodeId !== 'me' && node.userData.nodeId !== currentTarget) {
    node.userData.label.style.display = 'none';
    node.userData.label.style.visibility = 'hidden';
    node.userData.label.style.opacity = '0';
  }
  
  // Reset cursor
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
    while(parent && !nodeArray.includes(parent)) {
      parent = parent.parent;
    }
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
      
      // In 2D mode, lock Z position to 0
      if (!is3DMode) {
        draggedNode.position.z = 0;
      }

      const id = [...nodeObjs.entries()].find(([_, n]) => n === draggedNode)?.[0];
      if(id){
        const anim = nodeAnimations.get(id);
        if(anim) anim.originalPos.copy(draggedNode.position);
      }
      updateEdges();
    }
  } else {
    // Handle hover effects when not dragging
    setPointer(ev);
    raycaster.setFromCamera(pointer, camera);
    const nodeArray = Array.from(nodeObjs.values());
    const intersects = raycaster.intersectObjects(nodeArray, true);
    
    if(intersects.length > 0) {
      // Find the parent group that contains this mesh
      let parent = intersects[0].object.parent;
      while(parent && !nodeArray.includes(parent)) {
        parent = parent.parent;
      }
      
      if(parent && parent !== hoveredNode) {
        // New node hovered
        if(hoveredNode) {
          // Reset previous hovered node
          resetHoverEffect(hoveredNode);
        }
        
        // Apply hover effect to new node
        hoveredNode = parent;
        applyHoverEffect(hoveredNode);
      }
    } else if(hoveredNode) {
      // No node hovered, reset current hovered node
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

// Double-click handler to open LinkedIn profile
function onDoubleClick(ev) {
  setPointer(ev);
  raycaster.setFromCamera(pointer, camera);
  const nodeArray = Array.from(nodeObjs.values());
  const intersects = raycaster.intersectObjects(nodeArray, true);
  
  if (intersects.length > 0) {
    // Find the parent group that contains this mesh
    let parent = intersects[0].object.parent;
    while (parent && !nodeArray.includes(parent)) {
      parent = parent.parent;
    }
    
    if (parent && parent.userData && parent.userData.profileUrl) {
      // Open LinkedIn profile in new tab
      window.open(parent.userData.profileUrl, '_blank');
      console.log(`Opening LinkedIn profile for ${parent.userData.nodeId}: ${parent.userData.profileUrl}`);
    } else if (parent && parent.userData && parent.userData.nodeId === 'me') {
      // You node - no profile URL available
      console.log('You node clicked - no LinkedIn profile URL available');
    } else {
      console.log('No LinkedIn profile URL available for this node');
    }
  }
}

renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerup', onPointerUp);
renderer.domElement.addEventListener('pointerleave', onPointerUp);
renderer.domElement.addEventListener('dblclick', onDoubleClick);

// Search functionality
const searchInput = document.getElementById('search');
const highlightButton = document.getElementById('highlight');

function searchAndHighlight() {
  const searchTerm = searchInput.value.toLowerCase().trim();
  if (!searchTerm) return;
  
  // First try to find a specific person by name
  const matchingNode = sample.nodes.find(node => 
    node.name.toLowerCase().includes(searchTerm)
  );
  
  if (matchingNode) {
    console.log('Found matching person:', matchingNode);
    updateOptimalPath(matchingNode.id);
    return;
  }
  
  // If no person found, try to find by company
  const companyNodes = sample.nodes.filter(node => 
    node.company && node.company.toLowerCase().includes(searchTerm)
  );
  
  if (companyNodes.length > 0) {
    console.log(`Found ${companyNodes.length} people at company:`, companyNodes);
    updateMultipleOptimalPaths(searchTerm, companyNodes);
    return;
  }
  
  // No matches found
  const availableNames = sample.nodes.map(n => n.name).join(', ');
  const availableCompanies = sample.nodes.filter(n => n.company).map(n => n.company).join(', ');
  alert(`No match found for "${searchTerm}".\n\nTry:\nNames: ${availableNames}\nCompanies: ${availableCompanies}`);
}

highlightButton.addEventListener('click', searchAndHighlight);
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    searchAndHighlight();
  }
});

// 2D/3D Toggle functionality
const viewToggle3D = document.getElementById('viewToggle');
const viewToggle2D = document.getElementById('viewToggle2d');

viewToggle3D.addEventListener('click', () => switchTo3D());
viewToggle2D.addEventListener('click', () => switchTo2D());

// Collapsible sidebar functionality
const sidebar = document.getElementById('sidebar');
const sidebarHeader = document.getElementById('sidebarHeader');
const dropdownArrow = document.getElementById('dropdownArrow');

let isSidebarCollapsed = true; // Start collapsed

// Toggle sidebar collapse/expand
sidebarHeader.addEventListener('click', () => {
  isSidebarCollapsed = !isSidebarCollapsed;
  
  if (isSidebarCollapsed) {
    sidebar.classList.add('collapsed');
    dropdownArrow.classList.remove('expanded');
  } else {
    sidebar.classList.remove('collapsed');
    dropdownArrow.classList.add('expanded');
  }
});

// Path-only toggle functionality
const pathOnlyToggle = document.getElementById('pathOnlyToggle');
let isPathOnlyMode = false;
let hiddenNodes = new Set(); // Store nodes that are hidden

// Toggle path-only mode
pathOnlyToggle.addEventListener('click', () => {
  isPathOnlyMode = !isPathOnlyMode;
  
  if (isPathOnlyMode) {
    // Hide all nodes except those in optimal path
    showOnlyOptimalPathNodes();
    pathOnlyToggle.classList.add('active');
    pathOnlyToggle.textContent = 'Show All';
  } else {
    // Show all nodes
    showAllNodes();
    pathOnlyToggle.classList.remove('active');
    pathOnlyToggle.textContent = 'Path Only';
  }
});

function showOnlyOptimalPathNodes() {
  // Check if we have multiple paths or single path
  if (currentMultiplePaths && currentMultiplePaths.paths.length > 0) {
    showOnlyMultiplePathsNodes();
    return;
  }
  
  // If no optimal path is selected, show all nodes
  if (!currentTarget || currentOptimalPath.path.length === 0) {
    console.log('No optimal path selected - showing all nodes');
    return;
  }
  
  // Clear previous hidden nodes first to ensure clean state
  hiddenNodes.forEach(nodeId => {
    const node = nodeObjs.get(nodeId);
    if (node) {
      node.visible = true;
    }
  });
  hiddenNodes.clear();
  
  // Get all nodes that should be visible (You + optimal path nodes)
  const visibleNodeIds = new Set(['me', ...currentOptimalPath.path]);
  console.log(`Path-only mode: Visible nodes for current path:`, Array.from(visibleNodeIds));
  
  // Hide all nodes first
  nodeObjs.forEach((node, nodeId) => {
    if (!visibleNodeIds.has(nodeId)) {
      node.visible = false;
      hiddenNodes.add(nodeId);
    } else {
      node.visible = true;
      hiddenNodes.delete(nodeId);
    }
  });
  
  // Hide all edges that don't connect visible nodes
  edgeLines.forEach((line, edgeKey) => {
    const [sourceId, targetId] = edgeKey.split('-');
    const shouldShowEdge = visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
    line.visible = shouldShowEdge;
  });
  
  // Hide all cylinders (optimal path edges) that don't connect visible nodes
  edgeGroup.children.forEach(child => {
    if (child.userData && child.userData.isOptimalEdge) {
      const [sourceId, targetId] = child.userData.edgeKey.split('-');
      const shouldShowEdge = visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
      child.visible = shouldShowEdge;
    }
  });
  
  console.log(`Path-only mode: Showing ${visibleNodeIds.size} nodes and their connecting edges`);
}

function showOnlyMultiplePathsNodes() {
  // If no multiple paths are selected, show all nodes
  if (!currentMultiplePaths || currentMultiplePaths.paths.length === 0) {
    console.log('No multiple paths selected - showing all nodes');
    return;
  }
  
  // Clear previous hidden nodes first to ensure clean state
  hiddenNodes.forEach(nodeId => {
    const node = nodeObjs.get(nodeId);
    if (node) {
      node.visible = true;
    }
  });
  hiddenNodes.clear();
  
  // Get all nodes that should be visible (You + all path nodes)
  const visibleNodeIds = new Set(['me']);
  currentMultiplePaths.paths.forEach(pathData => {
    pathData.path.forEach(nodeId => visibleNodeIds.add(nodeId));
  });
  console.log(`Path-only mode: Visible nodes for multiple paths:`, Array.from(visibleNodeIds));
  
  // Hide all nodes first
  nodeObjs.forEach((node, nodeId) => {
    if (!visibleNodeIds.has(nodeId)) {
      node.visible = false;
      hiddenNodes.add(nodeId);
    } else {
      node.visible = true;
      hiddenNodes.delete(nodeId);
    }
  });
  
  // Hide all edges that don't connect visible nodes
  edgeLines.forEach((line, edgeKey) => {
    const [sourceId, targetId] = edgeKey.split('-');
    const shouldShowEdge = visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
    line.visible = shouldShowEdge;
  });
  
  // Hide all cylinders (optimal path edges) that don't connect visible nodes
  edgeGroup.children.forEach(child => {
    if (child.userData && child.userData.isOptimalEdge) {
      const [sourceId, targetId] = child.userData.edgeKey.split('-');
      const shouldShowEdge = visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
      child.visible = shouldShowEdge;
    }
  });
  
  console.log(`Path-only mode: Showing ${visibleNodeIds.size} nodes and their connecting edges for multiple paths`);
}

function showAllNodes() {
  // Show all nodes
  nodeObjs.forEach((node, nodeId) => {
    node.visible = true;
  });
  
  // Show all edges
  edgeLines.forEach((line, edgeKey) => {
    line.visible = true;
  });
  
  // Show all cylinders (optimal path edges)
  edgeGroup.children.forEach(child => {
    if (child.userData && child.userData.isOptimalEdge) {
      child.visible = true;
    }
  });
  
  hiddenNodes.clear();
  console.log('Show all mode: Displaying all nodes and edges');
}

// Switch to 3D mode
function switchTo3D() {
  if (is3DMode) return;
  is3DMode = true;
  updateToggleButtons();
  updateControlsForMode();
  ensureRenderOrder();
  animateToLayout('3d');
}

// Switch to 2D mode
function switchTo2D() {
  if (!is3DMode) return;
  is3DMode = false;
  updateToggleButtons();
  updateControlsForMode();
  ensureRenderOrder();
  animateToLayout('2d');
}

// Update toggle button states
function updateToggleButtons() {
  viewToggle3D.classList.toggle('active', is3DMode);
  viewToggle2D.classList.toggle('active', !is3DMode);
}

// Update camera controls based on mode
function updateControlsForMode() {
  if (is3DMode) {
    // 3D mode - full 3D controls
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
  } else {
    // 2D mode - constrain to 2D plane
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minPolarAngle = Math.PI/2 - 0.1; // Lock to top-down view
    controls.maxPolarAngle = Math.PI/2 + 0.1;
  }
}

// Ensure proper render order for both 2D and 3D modes
function ensureRenderOrder() {
  // Ensure all profile pictures are on top
  nodeObjs.forEach((node, nodeId) => {
    node.children.forEach(child => {
      if (child.userData.isBillboard && child.material) {
        child.renderOrder = 100; // Very high render order
        child.material.depthWrite = true;
        child.material.depthTest = true;
      }
    });
  });
  
  // Ensure all edges are behind nodes
  edgeGroup.children.forEach(edge => {
    edge.renderOrder = -10;
    if (edge.material) {
      edge.material.depthWrite = true;
      edge.material.depthTest = true;
    }
  });
  
  // Ensure optimal path cylinders are behind nodes but above edges
  edgeGroup.children.forEach(cylinder => {
    if (cylinder.userData && cylinder.userData.isOptimalEdge) {
      cylinder.renderOrder = -5;
      if (cylinder.material) {
        cylinder.material.depthWrite = true;
        cylinder.material.depthTest = true;
      }
    }
  });
}

// Animate nodes to new layout
function animateToLayout(mode) {
  const duration = 1000; // 1 second animation
  const startTime = performance.now();
  
  // Store original positions
  const originalPositions = new Map();
  nodeObjs.forEach((node, nodeId) => {
    originalPositions.set(nodeId, node.position.clone());
  });
  
  // Calculate target positions - much simpler approach
  const targetPositions = new Map();
  nodeObjs.forEach((node, nodeId) => {
    const currentPos = node.position.clone();
    let targetPos;
    
    if (mode === '2d') {
      // Going to 2D: freeze current X,Y, set Z to 0
      targetPos = new THREE.Vector3(currentPos.x, currentPos.y, 0);
      // Store the original Z position for restoration later
      frozenZPositions.set(nodeId, currentPos.z);
    } else {
      // Going to 3D: restore X,Y,Z (or use current if no frozen Z)
      const frozenZ = frozenZPositions.get(nodeId);
      if (frozenZ !== undefined) {
        // Use the frozen Z position directly for smooth transition
        targetPos = new THREE.Vector3(currentPos.x, currentPos.y, frozenZ);
        frozenZPositions.delete(nodeId); // Clear the frozen position
      } else {
        // No frozen Z, just use current position
        targetPos = currentPos.clone();
      }
    }
    targetPositions.set(nodeId, targetPos);
  });
  
  // Animate camera position
  const targetCameraPos = mode === '2d' ? 
    new THREE.Vector3(0, 0, 350) : 
    new THREE.Vector3(250, 250, 250);
  
  const startCameraPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const targetControlsTarget = new THREE.Vector3(0, 0, 0);
  
  function animateLayout() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Use a smoother easing function for 2D to 3D transitions
    let easedProgress;
    if (mode === '2d') {
      // 3D to 2D: use standard easing
      easedProgress = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    } else {
      // 2D to 3D: use smoother easing to prevent skipping
      easedProgress = progress * progress * (3 - 2 * progress); // Smooth step function
    }
    
    // Animate node positions
    nodeObjs.forEach((node, nodeId) => {
      const startPos = originalPositions.get(nodeId);
      const targetPos = targetPositions.get(nodeId);
      if (startPos && targetPos) {
        node.position.lerpVectors(startPos, targetPos, easedProgress);
      }
    });
    
    // Animate camera
    camera.position.lerpVectors(startCameraPos, targetCameraPos, easedProgress);
    controls.target.lerpVectors(startTarget, targetControlsTarget, easedProgress);
    controls.update();
    
    if (progress < 1) {
      requestAnimationFrame(animateLayout);
    } else {
      // Update original positions for floating animation
      nodeObjs.forEach((node, nodeId) => {
        const anim = nodeAnimations.get(nodeId);
        if (anim) {
          anim.originalPos.copy(node.position);
        }
      });
    }
  }
  
  animateLayout();
}

// Industry clustering analysis
function analyzeIndustryClusters() {
  const industryMap = new Map();
  
  sample.nodes.forEach(node => {
    if (node.company) {
      const industry = getIndustryFromCompany(node.company);
      if (!industryMap.has(industry)) {
        industryMap.set(industry, []);
      }
      industryMap.get(industry).push(node);
    }
  });
  
  let largestCluster = { industry: 'Unknown', count: 0, nodes: [] };
  for (const [industry, nodes] of industryMap) {
    if (nodes.length > largestCluster.count) {
      largestCluster = { industry, count: nodes.length, nodes };
    }
  }
  
  return largestCluster;
}

function getIndustryFromCompany(company) {
  const techCompanies = ['Google', 'Meta', 'Apple', 'Microsoft', 'Stripe', 'Amazon', 'Netflix', 'Uber', 'Airbnb', 'Tesla', 'SpaceX', 'OpenAI', 'Anthropic'];
  const financeCompanies = ['Goldman Sachs', 'JPMorgan', 'Morgan Stanley', 'BlackRock', 'Vanguard', 'Fidelity', 'Wells Fargo', 'Bank of America', 'Citigroup'];
  const consultingCompanies = ['McKinsey', 'Bain', 'BCG', 'Deloitte', 'PwC', 'EY', 'KPMG', 'Accenture'];
  
  if (techCompanies.includes(company)) return 'Software Engineering';
  if (financeCompanies.includes(company)) return 'Finance';
  if (consultingCompanies.includes(company)) return 'Consulting';
  
  return 'Other';
}

function updateLargestCluster() {
  const cluster = analyzeIndustryClusters();
  const clusterDiv = document.getElementById('largest-cluster');
  if (clusterDiv) {
    clusterDiv.innerHTML = `Largest cluster: ${cluster.industry} (${cluster.count} people)`;
  }
}

updateLargestCluster();

// Animation loop
function animate(){
  requestAnimationFrame(animate);

  // Gentle float animation (skip dragged and hovered)
  const t = performance.now()*0.001;
  nodeObjs.forEach((node, id)=>{
    if(node === draggedNode || node === hoveredNode) return;
    const a = nodeAnimations.get(id); 
    if(!a) return;
    
    // Keep X and Y floating consistent between 2D and 3D modes
    const fx = Math.sin(t*a.frequency + a.timeOffset) * a.amplitude * 0.3;
    const fy = Math.sin(t*a.frequency*0.7 + a.timeOffset + Math.PI/3) * a.amplitude * 0.3;
    
    let fz;
    if (is3DMode) {
      // 3D mode - add Z movement
      fz = Math.sin(t*a.frequency*0.5 + a.timeOffset + Math.PI/2) * a.amplitude * 0.4;
    } else {
      // 2D mode - no Z movement
      fz = 0;
    }

    // Apply floating animation
    node.position.set(a.originalPos.x + fx, a.originalPos.y + fy, a.originalPos.z + fz);
    
    // In 2D mode, force Z to stay at 0
    if (!is3DMode) {
      node.position.z = 0;
    }
    
    // Ensure profile pictures always render on top in both 2D and 3D modes
    node.children.forEach(child => {
      if (child.userData.isBillboard && child.material) {
        // Force profile pictures to always be on top
        child.renderOrder = 100; // Very high render order
        child.material.depthWrite = true;
        child.material.depthTest = true;
      }
    });

    const s = 1 + Math.sin(t*a.scaleFrequency + a.timeOffset)*a.scaleAmplitude;
    node.scale.setScalar(s);
    node.rotation.z = Math.sin(t*0.2 + a.timeOffset)*0.1;
    
    // Pulsing glow effect
    if(a.outerGlow && a.innerGlow && a.core) {
      const glowPulse = 1 + Math.sin(t*0.8 + a.timeOffset) * 0.3;
      const opacityPulse = 0.1 + Math.sin(t*1.2 + a.timeOffset) * 0.05;
      
      a.outerGlow.scale.setScalar(glowPulse);
      a.outerGlow.material.opacity = opacityPulse;
      a.innerGlow.scale.setScalar(glowPulse * 0.8);
      a.innerGlow.material.opacity = 0.3 + Math.sin(t*1.5 + a.timeOffset) * 0.1;
      a.core.scale.setScalar(glowPulse * 0.6);
    }
    
    // Billboard rotation for profile picture planes and glow effects
    node.children.forEach(child => {
      if (child.userData.isBillboard) {
        // Make both profile pictures and glow effects always face the camera directly
        const worldPosition = new THREE.Vector3();
        child.getWorldPosition(worldPosition);
        
        // Calculate direction from child to camera
        const direction = new THREE.Vector3().subVectors(camera.position, worldPosition);
        direction.normalize();
        
        // Create a look-at matrix to face the camera directly
        const lookAtMatrix = new THREE.Matrix4();
        lookAtMatrix.lookAt(worldPosition, camera.position, camera.up);
        
        // Extract rotation from the look-at matrix
        const quaternion = new THREE.Quaternion();
        quaternion.setFromRotationMatrix(lookAtMatrix);
        
        // Apply the rotation to make it face the camera directly
        child.quaternion.copy(quaternion);
        
        // Ensure profile pictures always render on top and occlude edges
        child.renderOrder = 100; // Very high render order
        if (child.material) {
          child.material.depthWrite = true;
          child.material.depthTest = true;
          child.material.transparent = false; // Ensure solid occlusion
          child.material.opacity = 1.0; // Ensure full opacity
        }
      }
    });
  });

  // Update optimal path cylinder positions when nodes move
  if (currentOptimalPath && currentOptimalPath.edges.size > 0) {
    edgeGroup.children.forEach(child => {
      if (child.userData && child.userData.isOptimalEdge) {
        const edgeKey = child.userData.edgeKey;
        const [sourceId, targetId] = edgeKey.split('-');
        const sourceNode = nodeObjs.get(sourceId);
        const targetNode = nodeObjs.get(targetId);
        
        if (sourceNode && targetNode) {
          // Update cylinder position and rotation
          const direction = new THREE.Vector3().subVectors(targetNode.position, sourceNode.position);
          const length = direction.length();
          const midpoint = new THREE.Vector3().addVectors(sourceNode.position, targetNode.position).multiplyScalar(0.5);
          
          child.position.copy(midpoint);
          child.lookAt(targetNode.position);
          child.rotateX(Math.PI / 2);
          
          // Update cylinder scale to match new length
          child.scale.set(1, length / child.geometry.parameters.height, 1);
        }
      }
    });
  }
  
  // Network rotation disabled - all nodes remain stationary
  // (Previous rotation code removed)
  
  // Add slow pulsing animation to all node glows
  nodeObjs.forEach((node, nodeId) => {
    let glowCount = 0;
    node.children.forEach(child => {
      if (child.userData.isGlow && !child.userData.isHighlighted) {
        glowCount++;
        // Slow pulsing animation for all glows (except highlighted ones)
        const glowPulse = 1 + Math.sin(t * 0.8) * 0.15; // Slow, gentle pulse
        const opacityPulse = 0.7 + Math.sin(t * 1.2) * 0.2; // Gentle opacity pulse
        child.scale.setScalar(glowPulse);
        if (child.material) {
          // Ensure correct color is maintained
          const originalColor = nodeId === 'me' ? 0x4CAF50 : 0x4DA6FF; // Blue for 1st-degree connections
          child.material.color.setHex(originalColor);
          child.material.opacity = Math.min(opacityPulse, 1.0);
          // Mark this glow as being animated so other code doesn't override it
          child.userData.isPulsing = true;
        }
      }
    });
    
    // Debug: Log glow count for each node every 200 frames
    if (Math.floor(t * 60) % 200 === 0 && glowCount > 0) {
      console.log(`Node ${nodeId}: ${glowCount} glows pulsing`);
    }
  });

  // Add pulsing scale animation for all highlighted nodes in optimal path
  highlightedNodes.forEach(nodeId => {
    if (nodeId !== 'me') {
      const node = nodeObjs.get(nodeId);
      if (node) {
        const pulseScale = 1 + Math.sin(t * 2) * 0.2; // Pulsing scale animation
        node.scale.setScalar(pulseScale);
        
        // Also pulse the glow effects with correct colors
        node.children.forEach(child => {
          if (child.userData.isGlow) {
            // Make target node glow slightly larger for emphasis
            const isTarget = nodeId === currentTarget;
            const glowPulse = isTarget ? 
              1 + Math.sin(t * 2.5) * 0.4 : // Larger pulse for target node
              1 + Math.sin(t * 2.5) * 0.3;  // Normal pulse for intermediate nodes
            const opacityPulse = 0.5 + Math.sin(t * 1.8) * 0.3; // Pulse opacity too
            child.scale.setScalar(glowPulse);
            child.material.opacity = Math.min(opacityPulse, 1.0);
            // Mark as highlighted so it doesn't get overridden by general pulsing
            child.userData.isHighlighted = true;
            
            // Apply correct color based on node position in path
            if (nodeId === currentTarget) {
              // Target node - bright orange
              child.material.color.setHex(0xFF7043);
            } else if (currentOptimalPath.path.includes(nodeId)) {
              // Intermediate node - yellow
              child.material.color.setHex(0xffd700);
            } else {
              // Default color
              const originalColor = nodeId === 'me' ? 0x4CAF50 : 0x4DA6FF; // Blue for 1st-degree connections
              child.material.color.setHex(originalColor);
            }
          }
        });
      }
    }
  });
  
  // Reset non-highlighted nodes to original state
  nodeObjs.forEach((node, nodeId) => {
    if (!highlightedNodes.has(nodeId) && nodeId !== 'me') {
      // Reset scale to normal
      node.scale.setScalar(1);
      
      // Reset glow effects and profile pictures to original colors and opacity
      node.children.forEach(child => {
        if (child.userData.isBillboard) {
          // Reset profile picture to original color (no tint)
          child.material.color.setHex(0xffffff); // White for no tint
          child.material.opacity = 1.0; // Full opacity
        } else if (child.userData.isGlow) {
          const originalColor = nodeId === 'me' ? 0x4CAF50 : 0x4DA6FF; // Blue for 1st-degree connections
          child.material.color.setHex(originalColor);
          
          // Reset to original opacity based on glow layer
          const originalOpacities = nodeId === 'me' ? [0.4, 0.5, 0.6] : [0.3, 0.4, 0.5];
          child.material.opacity = originalOpacities[child.userData.glowIndex] || 0.3;
          child.scale.setScalar(1); // Reset glow scale
          // Clear highlighted flag so it can resume general pulsing
          child.userData.isHighlighted = false;
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

console.log('Three.js Network Visualizer loaded successfully!');
