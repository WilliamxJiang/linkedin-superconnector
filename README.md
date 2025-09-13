# LinkedIn Network Visualizer Chrome Extension

A beautiful 3D network visualization Chrome extension that displays your LinkedIn connections as an interactive graph with advanced search and pathfinding capabilities.

> **Note**: This is the visualizer-only version. The scraper integration will be added in a future release.

## Features

### 🎨 3D Visualization
- **Beautiful 3D spheres** with multi-layer glow effects
- **Smooth animations** including floating, pulsing, and rotation
- **Interactive camera controls** (drag to rotate, scroll to zoom)
- **Real-time node dragging** with dynamic edge updates

### 🔍 Smart Search & Pathfinding
- **Search by name or company** to find connections
- **Optimal path finding** algorithm that shows the best route through your network
- **Color-coded highlighting**:
  - 🟣 Purple: "You" (center node)
  - 🟡 Yellow: Intermediate nodes in the path
  - 🟠 Orange: Target node (searched person)
  - 🟢 Green: Optimal path edges

### 📊 Network Insights
- **Industry clustering analysis** to identify your largest professional clusters
- **Connection strength visualization** with different edge weights and colors
- **Dynamic sidebar** showing optimal paths and network insights

## Installation

### From Source
1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. Navigate to any LinkedIn profile page
6. Look for the "🌐 Visualize Network" button

## Usage

1. **Install the extension** following the steps above
2. **Go to any LinkedIn profile** (yours or others)
3. **Click "🌐 Visualize Network"** to open the 3D network view
4. **Search for people or companies** using the search box
5. **Drag nodes** to rearrange the network
6. **Use mouse controls** to rotate and zoom the 3D view

## Technical Details

### Built With
- **Three.js** - 3D graphics and animations
- **Chrome Extension Manifest V3** - Modern extension architecture
- **Canvas 2D/WebGL** - High-performance rendering
- **ES6 Modules** - Modern JavaScript architecture

### Architecture
- **Content Script** - Injects the visualizer into LinkedIn pages
- **Bundled Dependencies** - All Three.js modules bundled locally for CSP compliance
- **Modular Design** - Clean separation of concerns

## Development

### File Structure
```
├── manifest.json              # Extension configuration
├── content.js                 # Content script for LinkedIn injection
├── popup.html                 # Extension popup interface
├── popup.js                   # Popup functionality
├── styles.css                 # Extension styling
├── network.html               # Network visualizer interface
├── network-three-simple.js    # Main Three.js visualizer
├── three-bundle.js            # Bundled Three.js core library
├── orbit-controls-bundle.js   # Bundled camera controls
└── css2d-renderer-bundle.js   # Bundled 2D label renderer
```

### Key Features
- **CSP Compliant** - No external CDN dependencies
- **Performance Optimized** - 60fps animations with requestAnimationFrame
- **Memory Efficient** - Proper cleanup and resource management
- **Cross-Platform** - Works on all Chrome-supported platforms

## Sample Data

The extension includes sample LinkedIn network data for demonstration:
- **6 nodes** representing different professionals
- **6 edges** showing various connection types and strengths
- **Industry diversity** including tech, consulting, and finance
- **Realistic relationship weights** based on connection strength

## Future Enhancements

- [ ] **Integration with LinkedIn scraper** (in development by collaborator)
- [ ] Export network visualizations as images
- [ ] Advanced filtering and clustering options
- [ ] Network statistics and analytics
- [ ] Custom themes and color schemes
- [ ] Real-time data updates from LinkedIn

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **Three.js** community for the amazing 3D graphics library
- **LinkedIn** for the professional network platform
- **Chrome Extensions** team for the powerful extension APIs
