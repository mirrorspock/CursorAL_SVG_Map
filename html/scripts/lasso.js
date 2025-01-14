import { disablePostalCodeClicks, enablePostalCodeClicks, addAllPostalCodes, reloadSelectedPostalCodes } from './postalCodeManager.js';

export let isLassoActive = false;
let currentMode; // Add this line to keep track of the current mode

let lassoPoints = [];
let svgElement;
let addPostalCodeCallback;

export function setupLassoSelect(svg, addPostalCodeFunc) {
    svgElement = svg;
    addPostalCodeCallback = addPostalCodeFunc;
    const lassoButton = document.querySelector('.lasso-button');
    const lassoIndicatorButton = document.querySelector('.lasso-indicator-button');
    lassoButton.addEventListener('click', toggleLasso);
    lassoIndicatorButton.addEventListener('click', toggleLasso);

    svgElement.addEventListener('mousedown', startLasso);
    svgElement.addEventListener('mousemove', updateLasso);
    document.addEventListener('mouseup', endLasso);
}

// Add this new function to set the current mode
export function setLassoMode(mode) {
    currentMode = mode;
}

function toggleLasso() {
    // console.log('Toggle Lasso');
    isLassoActive = !isLassoActive;

    // console.log('Lasso Active:', isLassoActive);
    const mapContainer = document.getElementById('map-container');
    mapContainer.classList.toggle('lasso-active', isLassoActive);

    const lassoActiveIndicator = document.getElementById('lasso-active-indicator');
    lassoActiveIndicator.style.display = isLassoActive ? 'block' : 'none';

    // Change cursor and background color based on lasso state
    if (isLassoActive) {
        disablePostalCodeClicks();
        mapContainer.style.cursor = 'crosshair'; // Cursor for lasso active
        mapContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.1)'; // Change background color
    } else {
        enablePostalCodeClicks();
        mapContainer.style.cursor = 'grab'; // Cursor for pan hand when lasso is not active
        mapContainer.style.backgroundColor = ''; // Reset background color
    }

    const lassoButton = document.querySelector('.lasso-button');
    const lassoStatus = document.getElementById('lasso-status');
    lassoButton.innerHTML = isLassoActive ? '<i class="fas fa-times" style="color: red;"></i>' : '<i class="fas fa-highlighter"></i>';
    lassoButton.title = isLassoActive ? 'Cancel Lasso' : 'Lasso Select';

    lassoStatus.style.display = isLassoActive ? 'flex' : 'none';

    if (isLassoActive) {
        const paths = document.querySelectorAll('#map-container svg path');
        paths.forEach(path => {
            if (!path.classList.contains('selected')) {
                path.style.filter = 'grayscale(75%)';
            }
            path.style.cursor = 'crosshair'; // Ensure cursor remains crosshair
            path.addEventListener('mouseover', () => {
                if (isLassoActive) {
                    path.style.cursor = 'crosshair'; // Ensure cursor remains crosshair on hover
                }
            });
        });
        debugCounters.timeTaken = 0; // Reset timeTaken when activating lasso
        showDebugCounters();
    } else {
        const paths = document.querySelectorAll('#map-container svg path');
        paths.forEach(path => {
            path.style.filter = '';
            path.style.cursor = ''; // Reset cursor
        });
        hideDebugCounters();
    }
}

function startLasso(e) {
    // console.log('Start Lasso');
    if (!isLassoActive) return;
    e.preventDefault();
    const point = getSVGPoint(e.clientX, e.clientY);
    lassoPoints = [point];
    lassoStartTime = performance.now(); // Record the start time
    debugCounters.lassoPoints = 1;
    updateDebugCounters();
}

function updateLasso(e) {
    if (!isLassoActive || lassoPoints.length === 0) return;
    e.preventDefault();
    const point = getSVGPoint(e.clientX, e.clientY);
    lassoPoints.push(point);
    debugCounters.lassoPoints = lassoPoints.length;
    updateDebugCounters();
    drawLasso();
}

function getSVGPoint(x, y) {
    const pt = svgElement.createSVGPoint();
    pt.x = x;
    pt.y = y;
    return pt.matrixTransform(svgElement.getScreenCTM().inverse());
}

function drawLasso() {
    
    let existingLasso = svgElement.querySelector('#lasso');
    if (existingLasso) existingLasso.remove();

    const lasso = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    lasso.setAttribute('id', 'lasso');
    lasso.setAttribute('points', lassoPoints.map(p => `${p.x},${p.y}`).join(' '));
    lasso.setAttribute('fill', 'rgba(255, 0, 0, 0.1)'); // Red fill with 10% opacity
    lasso.setAttribute('stroke', '#ff0000'); // Bright red stroke
    lasso.setAttribute('stroke-width', '2');
    lasso.setAttribute('vector-effect', 'non-scaling-stroke');
    svgElement.appendChild(lasso);
}

function selectPathsInLasso() {
    const paths = document.querySelectorAll('#map-container svg path');
    debugCounters.pathsChecked = 0;
    debugCounters.pathsSelected = 0;
    const selectCountries = document.getElementById('select-countries').checked;
    // console.log('Select Countries:', selectCountries);
    paths.forEach(path => {
        // Skip paths that are not visible or have a hidden parent
        if (path.style.display === 'none') return;
        const parentGroup = path.closest('g');
        if (parentGroup && parentGroup.style.display === 'none') return;

        debugCounters.pathsChecked++;
        const bbox = path.getBBox();
        if (isBBoxInLasso(bbox)) {
            const isInLasso = isPathInLasso(path);
            if (isInLasso) {
                debugCounters.pathsSelected++;
                const postalCode = path.id || 'Unknown';
                addToSelection(path, postalCode);
                path.classList.add('selected');
                path.style.filter = '';

                // If "select countries" toggle is on, select the whole country
                if (selectCountries && parentGroup) {
                    const country = parentGroup.id;
                    addAllPostalCodes(country, currentMode);
                    // console.log('Select Country:', country);
                }
            }
        }
        updateDebugCounters();
    });
}

function isBBoxInLasso(bbox) {
    const bboxPoints = [
        { x: bbox.x, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y },
        { x: bbox.x, y: bbox.y + bbox.height },
        { x: bbox.x + bbox.width, y: bbox.y + bbox.height }
    ];
    return bboxPoints.some(point => isPointInPolygon(point, lassoPoints));
}

function isPathInLasso(path) {
    const { points } = getPathPoints(path);
    return points.some(point => isPointInPolygon(point, lassoPoints)) || isPointInPolygon(points[0], lassoPoints);
}

function getPathPoints(path) {
    const points = [];
    const zoomFactor = getZoomFactor(); // Assume this function returns the current zoom factor
    const useSimplified = zoomFactor < 5;
    const dAttribute = useSimplified ? 'data-simplified-d' : 'd';
    const pathData = path.getAttribute(dAttribute);
    
    if (!pathData) {
        console.warn(`Path ${path.id} does not have a ${dAttribute} attribute.`);
        return { points, svg: path.ownerSVGElement };
    }

    const pathLength = path.getTotalLength();
    const step = pathLength / 20; // Increase step size to reduce number of points checked
    // console.log('Path Length:', pathLength);
    // console.log('Step Size:', step);
    const svg = path.ownerSVGElement;
    const debugGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    debugGroup.setAttribute("id", "debug-points");
    svg.appendChild(debugGroup);
    for (let i = 0; i <= pathLength; i += step) {
        const point = path.getPointAtLength(i);
        if (!points.some(p => p.x === point.x && p.y === point.y)) {
            points.push(point);
        }
    }
    // console.log('Total Points Collected:', points.length);
    return { points, svg };
}

// Add this function to get the current zoom factor
function getZoomFactor() {
    const zoomFactorElement = document.getElementById('zoom-factor');
    if (zoomFactorElement) {
        const zoomText = zoomFactorElement.textContent;
        const zoomMatch = zoomText.match(/Zoom:\s*([\d.]+)x/);
        if (zoomMatch) {
            return parseFloat(zoomMatch[1]);
        }
    }
    return 1; // Default zoom factor
}

export function isPointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        
        const intersect = ((yi > point.y) !== (yj > point.y))
            && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function clearLasso() {
    const lasso = svgElement.querySelector('#lasso');
    if (lasso) lasso.remove();
    lassoPoints = [];
}

function endLasso(e) {
    if (!isLassoActive || lassoPoints.length === 0) return;
    e.preventDefault();
    const point = getSVGPoint(e.clientX, e.clientY);
    lassoPoints.push(point);

    // If the user clicks without dragging, end the lasso
    if (lassoPoints.length === 2 && lassoPoints[0].x === lassoPoints[1].x && lassoPoints[0].y === lassoPoints[1].y) {
        clearLasso();
        return;
    }

    drawLasso();
    
    const endTime = performance.now();
    const timeTaken = endTime - lassoStartTime;
    debugCounters.timeTaken = timeTaken.toFixed(2); // Round to 2 decimal places
    
    selectPathsInLasso();
    updateDebugCounters(); // Update counters one last time
    clearLasso();
    reloadSelectedPostalCodes(); // Add this line to reload selected postal codes after lasso selection
    // Remove debug points after a short delay
    setTimeout(() => {
        const debugGroup = svgElement.querySelector('#debug-points');
        if (debugGroup) {
            svgElement.removeChild(debugGroup);
        }
    }, 2000);
    // Don't reset the timeTaken here

}

function debugLasso() {
    // console.log('Lasso Points:', lassoPoints);
    // console.log('SVG Element:', svgElement);
    const lasso = svgElement.querySelector('#lasso');
    // console.log('Lasso Element:', lasso);
    if (lasso) {
        // console.log('Lasso Attributes:', lasso.attributes);
    }
}

// Add these variables at the top of the file
let debugCounters = {
    lassoPoints: 0,
    pathsChecked: 0,
    pathsSelected: 0,
    timeTaken: 0
};

// Add this function to update the debug counters on screen
function updateDebugCounters() {
    let debugElement = document.getElementById('lasso-debug');
    if (!debugElement) {
        debugElement = document.createElement('div');
        debugElement.id = 'lasso-debug';
        debugElement.style.position = 'fixed';
        debugElement.style.top = '10px';
        debugElement.style.right = '10px';
        debugElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        debugElement.style.color = 'white';
        debugElement.style.padding = '10px';
        debugElement.style.borderRadius = '5px';
        debugElement.style.fontFamily = 'monospace';
        debugElement.style.zIndex = '1000';
        debugElement.style.cursor = 'pointer';
        document.body.appendChild(debugElement);
        
        // Add click event listener to hide debug counters
        debugElement.addEventListener('click', hideDebugCounters);
    }
    debugElement.innerHTML = `
        Lasso Points: ${debugCounters.lassoPoints}<br>
        Paths Checked: ${debugCounters.pathsChecked}<br>
        Paths Selected: ${debugCounters.pathsSelected}<br>
        Time Taken: ${debugCounters.timeTaken || '0.00'} ms<br>
        (Click to hide)
    `;
}

// Add this variable at the top of the file
let lassoStartTime;

function showDebugCounters() {
    const debugElement = document.getElementById('lasso-debug');
    if (debugElement) {
        debugElement.style.display = 'block';
    } else {
        updateDebugCounters();
    }
}

function hideDebugCounters() {
    const debugElement = document.getElementById('lasso-debug');
    if (debugElement) {
        debugElement.style.display = 'none';
    }
}

// New function to add to selection
function addToSelection(path, postalCode) {
    if (!path.classList.contains('selected') || !path.classList.contains(currentMode)) {
        addPostalCodeCallback(path, postalCode, currentMode, true); // Add 'true' to indicate it's from lasso
    }
}
