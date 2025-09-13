// Three.js Network Visualizer for Chrome Extension
// Using bundled Three.js files to avoid CSP issues

console.log('Loading Three.js Network Visualizer...');

// Import bundled Three.js modules
import * as THREE from './three-bundle.js';
import { OrbitControls } from './orbit-controls-bundle.js';
import { CSS2DRenderer, CSS2DObject } from './css2d-renderer-bundle.js';

// Sample data
// const sample = {
//   nodes: [
//     {id:'me', name:'You', degree:1, company:'Ada', school:'UofT'},
//     {id:'a',  name:'Alex Chen', degree:1, company:'Stripe', school:'UofT'},
//     {id:'b',  name:'Bianca Patel', degree:1, company:'Meta', school:'Waterloo'},
//     {id:'d',  name:'Priya N.', degree:2, company:'Google', role:'Manager', school:'MIT'},
//     {id:'e',  name:'Sarah Kim', degree:1, company:'Apple', school:'Stanford'},
//     {id:'f',  name:'Mike Johnson', degree:1, company:'Microsoft', school:'MIT'}
//   ],
//   edges: [
//     {source:'me', target:'a', weight:0.8, reasons:['Direct connection']},
//     {source:'a',  target:'d', weight:0.6, reasons:['Same school']},
//     {source:'me', target:'b', weight:0.4, reasons:['Same region']},
//     {source:'d', target:'e', weight:0.7, reasons:['Tech industry']},
//     {source:'e', target:'f', weight:0.5, reasons:['Tech industry']},
//     {source:'b', target:'f', weight:0.3, reasons:['Tech industry']}
//   ]
// };


// const sample_data = localStorage.getItem('lsc-latest-profiles');
const sample_data = await chrome.storage.local.get('lsc-latest-profiles').then(res => res['lsc-latest-profiles']);
let graph;
console.log('sample_data')
console.log(sample_data)
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
        return seg.replace(/[^a-zA-Z0-9_-]/g, '') || `n${i}`;
      }
      return `n${i}`;
    };

    // dedupe by profile_url if present
    const seen = new Set();
    const unique = [];
    for (const p of profiles) {
      const key = (p?.profile_url || p?.name || '') + '|' + (p?.img || '');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }

    const nodes = [
      { id: 'me', name: 'You', degree: 1 } // minimal root node
    ];

    const edges = [];

    unique.forEach((p, i) => {
      const id = toId(p, i);

      nodes.push({
        id,
        name: p?.name || 'Unknown',
        degree: 1,
        // keep useful attrs (company/school omitted as requested)
        img: p?.img ?? null,
        description: p?.description ?? null,
        location: p?.location ?? null,
        profile_url: p?.profile_url ?? null
      });

      edges.push({
        source: id,       // from the person
        target: 'me',     // ...to 'me'
        weight: 1,
        reasons: ['Imported connection']
      });
    });

    graph = { nodes, edges };
  } catch (e) {
    console.warn('Failed to parse stored profile data, using sample data.', e);
  }
}

// Fallback sample if needed:
if (!graph) {
  graph = {
    nodes: [
      { id: 'me', name: 'You', degree: 1 },
      { id: 'crystal-ding', name: 'Crystal Ding', degree: 1, img: 'https://media.licdn.com/dms/image/v2/D5603AQFLFFo3TLOW6g/profile-displayphoto-shrink_100_100/profile-displayphoto-shrink_100_100/0/1695423773398?e=1760572800&v=beta&t=Y0g3_qBd8etFXM5IMcfMsH0kwbeLIhUua5FLBEOJRGc', description: 'A cat person who loves video games', location: null, profile_url: 'https://www.linkedin.com/in/crystal-ding/' }
    ],
    edges: [
      { source: 'crystal-ding', target: 'me', weight: 1, reasons: ['Imported connection'] }
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
camera.position.set(0, 0, 220);

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

// Create nodes
sample.nodes.forEach((n, idx) => {
  // Create glowing node group
  const glowNode = new THREE.Group();
  
  // Determine node color based on ID
  const nodeColor = n.id === 'me' ? 0x9d4edd : 0x4da6ff;
  
  // Outer glow sphere
  const outerGlow = new THREE.Mesh(
    new THREE.SphereGeometry(12, 16, 12),
    new THREE.MeshBasicMaterial({ 
      color: nodeColor,
      transparent: true,
      opacity: 0.1,
      side: THREE.BackSide
    })
  );
  glowNode.add(outerGlow);
  
  // Inner glow sphere
  const innerGlow = new THREE.Mesh(
    new THREE.SphereGeometry(8, 16, 12),
    new THREE.MeshBasicMaterial({ 
      color: nodeColor,
      transparent: true,
      opacity: 0.3
    })
  );
  glowNode.add(innerGlow);
  
  // Core sphere
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(4, 16, 12),
    new THREE.MeshBasicMaterial({ 
      color: nodeColor,
      transparent: true,
      opacity: 0.8
    })
  );
  glowNode.add(core);
  
  // Layout nodes with 'me' at center
  if (n.id === 'me') {
    glowNode.position.set(0, 0, 0);
  } else {
    const angle = (idx - 1) * (Math.PI * 2) / (sample.nodes.length - 1);
    const radius = 60;
    glowNode.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0
    );
  }
  nodeGroup.add(glowNode);
  nodeObjs.set(n.id, glowNode);

  const labelDiv = document.createElement("div");
  labelDiv.className = "tooltip";
  labelDiv.textContent = n.name;
  const label = new CSS2DObject(labelDiv);
  label.position.set(0, -12, 0);
  glowNode.add(label);

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
  
  // Determine edge strength based on weight
  let color, opacity, linewidth;
  if (e.weight >= 0.7) {
    color = 0x4da6ff;
    opacity = 0.9;
    linewidth = 3;
  } else if (e.weight >= 0.5) {
    color = 0x6b9bd2;
    opacity = 0.8;
    linewidth = 2;
  } else {
    color = 0x9aa7c6;
    opacity = 0.6;
    linewidth = 1;
  }
  
  const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ 
    color: color, 
    transparent: true, 
    opacity: opacity,
    linewidth: linewidth
  }));
  edgeGroup.add(line);
  edgeLines.set(`${e.source}-${e.target}`, line);
});

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
  
  const originalColor = nodeId === 'me' ? 0x9d4edd : 0x4da6ff;
  
  if (highlightType === 'target') {
    // Target node - bright orange
    highlightedNodes.add(nodeId);
    node.children.forEach(child => {
      if (child.material) {
        child.material.color.setHex(0xff6b35); // Bright orange
      }
    });
  } else if (highlightType === 'intermediate') {
    // Intermediate node - yellow
    highlightedNodes.add(nodeId);
    node.children.forEach(child => {
      if (child.material) {
        child.material.color.setHex(0xffd700); // Gold/yellow
      }
    });
  } else {
    // Clear highlighting
    highlightedNodes.delete(nodeId);
    node.children.forEach(child => {
      if (child.material) {
        child.material.color.setHex(originalColor);
      }
    });
  }
}

function updateOptimalPath(targetId) {
  // Clear previous highlights
  highlightedNodes.forEach(nodeId => highlightNode(nodeId, 'none'));
  highlightedNodes.clear();
  
  currentTarget = targetId;
  currentOptimalPath = findOptimalPathToTarget(targetId);
  
  // Highlight nodes in the optimal path with different colors
  currentOptimalPath.path.forEach((nodeId, index) => {
    if (nodeId !== 'me') { // Don't highlight the 'me' node
      if (nodeId === targetId) {
        // Target node - bright orange
        highlightNode(nodeId, 'target');
      } else {
        // Intermediate node - yellow
        highlightNode(nodeId, 'intermediate');
      }
    }
  });
  
  // Update edge colors
  sample.edges.forEach(e => {
    const line = edgeLines.get(`${e.source}-${e.target}`);
    if (!line) return;
    
    const isOptimal = currentOptimalPath.edges.has(`${e.source}-${e.target}`);
    
    if (isOptimal) {
      // Highlight optimal path edges in bright green
      line.material.color.setHex(0x00ff88);
      line.material.opacity = 0.9;
      line.material.linewidth = 4; // Even thicker for optimal path
    } else {
      // Restore original strength-based colors
      let color, opacity, linewidth;
      if (e.weight >= 0.7) {
        color = 0x4da6ff; // Bright blue
        opacity = 0.9;
        linewidth = 3;
      } else if (e.weight >= 0.5) {
        color = 0x6b9bd2; // Medium blue
        opacity = 0.8;
        linewidth = 2;
      } else {
        color = 0x9aa7c6; // Gray
        opacity = 0.6;
        linewidth = 1;
      }
      
      line.material.color.setHex(color);
      line.material.opacity = opacity;
      line.material.linewidth = linewidth;
    }
  });
  
  // Update sidebar info
  updateSidebarInfo();
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
    ${pathNames.join(' → ')}
  `;
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

      const id = [...nodeObjs.entries()].find(([_, n]) => n === draggedNode)?.[0];
      if(id){
        const anim = nodeAnimations.get(id);
        if(anim) anim.originalPos.copy(draggedNode.position);
      }
      updateEdges();
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

// Search functionality
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
    console.log('Found matching node:', matchingNode);
    updateOptimalPath(matchingNode.id);
  } else {
    const availableNames = sample.nodes.map(n => n.name).join(', ');
    const availableCompanies = sample.nodes.filter(n => n.company).map(n => n.company).join(', ');
    alert(`No match found for "${searchTerm}".\n\nTry:\nNames: ${availableNames}\nCompanies: ${availableCompanies}`);
  }
}

highlightButton.addEventListener('click', searchAndHighlight);
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    searchAndHighlight();
  }
});

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

  // Gentle float animation (skip dragged)
  const t = performance.now()*0.001;
  nodeObjs.forEach((node, id)=>{
    if(node === draggedNode) return;
    const a = nodeAnimations.get(id); 
    if(!a) return;
    
    const fx = Math.sin(t*a.frequency + a.timeOffset) * a.amplitude * 0.3;
    const fy = Math.sin(t*a.frequency*0.7 + a.timeOffset + Math.PI/3) * a.amplitude;
    const fz = Math.sin(t*a.frequency*0.5 + a.timeOffset + Math.PI/2) * a.amplitude * 0.2;

    node.position.set(a.originalPos.x + fx, a.originalPos.y + fy, a.originalPos.z + fz);

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
