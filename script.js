(function() {
    const SHEET_ID = '1g--ydME6sFvsE44He1C4AO4uQRxwOtJm';
    const MONITOR_SHEET_GID = '849721815';
    const LAYOUT_SHEET_GID = '183478124';
    const MONITOR_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${MONITOR_SHEET_GID}`;
    const LAYOUT_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${LAYOUT_SHEET_GID}`;
    const SHEET_EDIT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${MONITOR_SHEET_GID}`;

    const COL_INDEX_MONITOR = {
      INSTALL_STATUS: 0, FORCE_ASSIGNED: 1, ID: 2, CURRENT_INFO: 3, CURRENT_LOCATION_NAME: 4,
      PREVIOUS_LOCATION: 5, NOTES: 6
    };
    const COL_INDEX_LAYOUT = {
      FLOOR_LABEL: 0, GRID_COLUMNS: 1, ELEMENT_TYPE: 2, ELEMENT_NAME: 3,
      GRID_COL: 4, GRID_ROW: 5, GRID_COL_SPAN: 6, GRID_ROW_SPAN: 7
    };

    const STATUS = { INSTALLED: 'O', UNKNOWN: '?', EQUAL: '=' };
    const ELEMENT_TYPE = { ROOM: 'Room', CORRIDOR: 'Corridor' };
    const UNKNOWN_VALUE = '?';
    const LOST_LOCATION_LABEL = '어디론가 사라짐';

    const DOM_IDS = {
      FLOOR_PLAN_CONTAINER: 'floorPlanContainer',
      REFRESH_BUTTON: 'refreshButton',
      DOWNLOAD_BUTTON: 'downloadButton',
      SHEET_BUTTON: 'sheetButton',
      LOADING_MESSAGE: 'loading-message',
      ERROR_MESSAGE: 'error-message',
      PDF_OVERLAY: 'pdf-overlay'
    };
    const CSS_CLASSES = {
      VISIBLE: 'visible', FLOOR_SECTION: 'floor-section', SECTION_LABEL: 'section-label',
      GRID_CONTAINER: 'grid-container', LOST_MONITORS_GRID: 'lost-monitors-grid',
      CUBE: 'cube', CORRIDOR: 'corridor', CUBE_NAME: 'cube-name', CUBE_NAME_TEXT: 'cube-name-text',
      MONITOR_LIST: 'monitor-list', MONITOR_CUBE: 'monitor-cube',
      STATUS_GREEN: 'status-green', STATUS_RED: 'status-red', STATUS_YELLOW: 'status-yellow', STATUS_BLUE: 'status-blue',
      STATUS_ORANGE: 'status-orange',
      LOST_LOCATION_CUBE: 'lost-location-cube', LOST_LOCATION_NAME: 'lost-location-name',
      LOST_MONITOR_LIST: 'lost-monitor-list', SECTION_DIVIDER: 'section-divider',
      PDF_CAPTURE_MODE: 'pdf-capture-mode'
    };

    const { jsPDF } = window.jspdf;
    let validLocations = new Map();
    let schoolLayoutData = [];
    let resizeTimeout;

    const floorPlanContainer = document.getElementById(DOM_IDS.FLOOR_PLAN_CONTAINER);
    const refreshButton = document.getElementById(DOM_IDS.REFRESH_BUTTON);
    const downloadButton = document.getElementById(DOM_IDS.DOWNLOAD_BUTTON);
    const sheetButton = document.getElementById(DOM_IDS.SHEET_BUTTON);
    const loadingMessage = document.getElementById(DOM_IDS.LOADING_MESSAGE);
    const errorMessage = document.getElementById(DOM_IDS.ERROR_MESSAGE);
    const pdfOverlay = document.getElementById(DOM_IDS.PDF_OVERLAY);
    const pdfOverlayText = pdfOverlay.querySelector('span');

    function createEl(tag, className) {
        const element = document.createElement(tag);
        if (className) {
            if (Array.isArray(className)) element.classList.add(...className);
            else element.classList.add(className);
        }
        return element;
    }
    function setText(element, text) { element.textContent = text; }
    function setHtml(element, html) { element.innerHTML = html; }
    function appendChilds(parent, children) { children.forEach(child => parent.appendChild(child)); }
    function showElement(element) { element.style.display = ''; }
    function hideElement(element) { element.style.display = 'none'; }
    function setButtonDisabled(button, disabled) { button.disabled = disabled; }

    function parseCSV(text) {
        const rows = []; let currentRow = []; let currentField = ''; let inQuotes = false;
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (text.length > 0 && text[text.length - 1] !== '\n') text += '\n';
        for (let i = 0; i < text.length; i++) {
            const char = text[i]; const nextChar = text[i + 1];
            if (!inQuotes) {
                if (char === '"' && currentField === '') inQuotes = true;
                else if (char === ',') { currentRow.push(currentField.trim()); currentField = ''; }
                else if (char === '\n') {
                    currentRow.push(currentField.trim());
                    if (rows.length > 0 || currentRow.some(field => field !== '')) {
                        rows.push(currentRow);
                    }
                    currentRow = []; currentField = '';
                } else currentField += char;
            } else {
                if (char === '"') {
                    if (nextChar === '"') { currentField += '"'; i++; }
                    else inQuotes = false;
                } else currentField += char;
            }
        }
        return rows.length > 0 ? rows.slice(1) : [];
    }

    async function fetchSheetData(url, type) {
        const fetchUrl = `${url}&_=${new Date().getTime()}`;
        try {
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error(`HTTP 오류 (${type})! 상태: ${response.status}`);
            const csvText = await response.text();
            return parseCSV(csvText);
        } catch (error) {
            console.error(`${type} 데이터 로딩 오류:`, error);
            throw new Error(`${type} 시트 데이터를 가져오는 중 오류 발생: ${error.message}`);
        }
    }

    function parseLayoutData(rawData) {
        const floorsMap = new Map();
        const floorOrder = [];
        rawData.forEach(row => {
            const floorLabel = row[COL_INDEX_LAYOUT.FLOOR_LABEL];
            if (!floorLabel) return;

            if (!floorsMap.has(floorLabel)) {
                const gridColumns = parseInt(row[COL_INDEX_LAYOUT.GRID_COLUMNS], 10) || 9;
                floorsMap.set(floorLabel, {
                    label: floorLabel,
                    columns: gridColumns,
                    rooms: [], corridors: []
                });
                floorOrder.push(floorLabel);
            }

            const floorData = floorsMap.get(floorLabel);
            const elementType = row[COL_INDEX_LAYOUT.ELEMENT_TYPE];
            const element = {
                name: row[COL_INDEX_LAYOUT.ELEMENT_NAME] || '',
                col: parseInt(row[COL_INDEX_LAYOUT.GRID_COL], 10),
                row: parseInt(row[COL_INDEX_LAYOUT.GRID_ROW], 10),
                colSpan: parseInt(row[COL_INDEX_LAYOUT.GRID_COL_SPAN], 10) || 1,
                rowSpan: parseInt(row[COL_INDEX_LAYOUT.GRID_ROW_SPAN], 10) || 1
            };

            if (!isNaN(element.col) && !isNaN(element.row)) {
                if (elementType === ELEMENT_TYPE.ROOM) {
                    floorData.rooms.push(element);
                } else if (elementType === ELEMENT_TYPE.CORRIDOR) {
                    floorData.corridors.push(element);
                }
            }
        });

        return floorOrder.map(label => floorsMap.get(label));
    }

    function buildValidLocations() {
      validLocations = new Map();
      schoolLayoutData.forEach(floor => {
        floor.rooms?.forEach(room => {
          if (room.name) {
            validLocations.set(room.name, { label: floor.label, name: room.name });
          }
        });
      });
    }

    function normalizeValue(value) {
        return value?.trim() || UNKNOWN_VALUE;
    }

    function processMonitorData(rawData) {
        const allMonitors = rawData.map(row => {
            if (!Array.isArray(row) || row.length <= Math.max(...Object.values(COL_INDEX_MONITOR))) {
                return null;
            }
            return {
              installStatus: normalizeValue(row[COL_INDEX_MONITOR.INSTALL_STATUS]).toUpperCase(),
              isForceAssigned: normalizeValue(row[COL_INDEX_MONITOR.FORCE_ASSIGNED]).toUpperCase() === 'O',
              id: normalizeValue(row[COL_INDEX_MONITOR.ID]),
              current: normalizeValue(row[COL_INDEX_MONITOR.CURRENT_LOCATION_NAME]),
              previous: normalizeValue(row[COL_INDEX_MONITOR.PREVIOUS_LOCATION]),
              notes: row[COL_INDEX_MONITOR.NOTES] || ''
            };
        }).filter(monitor => monitor !== null && monitor.id !== UNKNOWN_VALUE);

        const monitorsByLocation = {};
        const monitorCounts = {};
        const monitorsCountPerFloor = {};
        const lostMonitors = [];

        schoolLayoutData.forEach(floor => {
            monitorsCountPerFloor[floor.label] = { installed: 0, notInstalled: 0, total: 0 };
            floor.rooms?.forEach(room => {
                 const displayKey = `${floor.label} ${room.name}`;
                 monitorCounts[displayKey] = { installed: 0, notInstalled: 0, total: 0 };
            });
        });

        allMonitors.forEach(monitor => {
            const locationInfo = validLocations.get(monitor.current);
            const isInstalled = monitor.installStatus === STATUS.INSTALLED;

            if (monitor.current === UNKNOWN_VALUE || !locationInfo) {
                lostMonitors.push(monitor);
            } else {
                const displayKey = `${locationInfo.label} ${locationInfo.name}`;
                const floorLabel = locationInfo.label;

                if (!monitorCounts[displayKey]) {
                     monitorCounts[displayKey] = { installed: 0, notInstalled: 0, total: 0 };
                }
                monitorCounts[displayKey].total++;
                if (isInstalled) monitorCounts[displayKey].installed++; else monitorCounts[displayKey].notInstalled++;

                if (!monitorsByLocation[displayKey]) {
                    monitorsByLocation[displayKey] = [];
                }
                monitorsByLocation[displayKey].push(monitor);

                if (!monitorsCountPerFloor[floorLabel]) {
                     monitorsCountPerFloor[floorLabel] = { installed: 0, notInstalled: 0, total: 0 };
                }
                monitorsCountPerFloor[floorLabel].total++;
                if (isInstalled) monitorsCountPerFloor[floorLabel].installed++; else monitorsCountPerFloor[floorLabel].notInstalled++;
            }
        });

        return { monitorsByLocation, monitorCounts, monitorsCountPerFloor, lostMonitors };
    }

    function formatCountString(counts) {
        if (!counts || counts.total === 0) return '';
        if (counts.installed === counts.total) {
            return `(${counts.installed})`;
        } else if (counts.installed === 0) {
            return `(0/${counts.notInstalled}/${counts.total})`;
        } else {
            return `(${counts.installed}/${counts.notInstalled}/${counts.total})`;
        }
    }

    function getMonitorStatusClass(monitor) {
        const currentIsUnknown = monitor.current.toUpperCase() === STATUS.UNKNOWN;
        const previousIsUnknown = monitor.previous.toUpperCase() === STATUS.UNKNOWN;
        const previousIsEqual = monitor.previous === STATUS.EQUAL;
        const isNotInstalled = monitor.installStatus !== STATUS.INSTALLED;
        const isForceAssigned = monitor.isForceAssigned === true;

        if (isNotInstalled) return CSS_CLASSES.STATUS_RED;
        if (isForceAssigned) return CSS_CLASSES.STATUS_ORANGE;
        if (previousIsUnknown || currentIsUnknown) return CSS_CLASSES.STATUS_YELLOW;
        if (previousIsEqual && !currentIsUnknown) return CSS_CLASSES.STATUS_BLUE;
        if (!currentIsUnknown) return CSS_CLASSES.STATUS_GREEN;
        return '';
    }

    function createMonitorCubeElement(monitor, displayKey) {
        const monitorCubeDiv = createEl('div', CSS_CLASSES.MONITOR_CUBE);
        monitorCubeDiv.style.outline = 'none';
        const displayId = monitor.installStatus !== STATUS.INSTALLED ? `[X] ${monitor.id}` : monitor.id;
        setText(monitorCubeDiv, displayId);
        monitorCubeDiv.title = monitor.id;

        const statusClass = getMonitorStatusClass(monitor);
        if (statusClass) monitorCubeDiv.classList.add(statusClass);

        monitorCubeDiv.addEventListener('click', () => {
          let previousLocationDisplay = monitor.previous;
          const prevLocationInfo = validLocations.get(previousLocationDisplay);

          if (prevLocationInfo) {
            previousLocationDisplay = `${prevLocationInfo.label} ${prevLocationInfo.name}`;
          }

          let alertMessage = `고유 번호: ${monitor.id}\n현재 위치: ${displayKey || monitor.current}\n이전 위치: ${previousLocationDisplay}`;
          if (monitor.installStatus !== STATUS.INSTALLED) alertMessage += `\n\n* 현재 사용중이지 않거나 사용 여부를 알 수 없는 모니터 입니다.`;
          if (monitor.isForceAssigned) alertMessage += `\n\n* 관리자에 의해 강제 배정된 모니터 입니다.`;
          if (monitor.notes) alertMessage += `\n\n----------\n\n${monitor.notes.replace(/\n/g, ' ').replace("  ", " ")}`;
          alert(alertMessage);
        });
        return monitorCubeDiv;
    }

    function createCubeElement(roomData, isCorridor = false, floorLabel = '', monitorCounts, monitorsByLocation) {
      const cubeDiv = createEl('div', isCorridor ? [CSS_CLASSES.CUBE, CSS_CLASSES.CORRIDOR] : CSS_CLASSES.CUBE);
      cubeDiv.style.gridColumn = `${roomData.col} / span ${roomData.colSpan || 1}`;
      cubeDiv.style.gridRow = `${roomData.row} / span ${roomData.rowSpan || 1}`;
      cubeDiv.dataset.row = roomData.row;

      if (!isCorridor) {
        const nameDiv = createEl('div', CSS_CLASSES.CUBE_NAME);
        const displayKey = `${floorLabel} ${roomData.name}`;
        const countData = monitorCounts[displayKey];
        const countStr = formatCountString(countData);
        setHtml(nameDiv, `<span class="${CSS_CLASSES.CUBE_NAME_TEXT}">${roomData.name}</span>${countStr ? ` ${countStr}` : ''}`);
        cubeDiv.appendChild(nameDiv);

        const monitorsInRoom = monitorsByLocation[displayKey];
        if (monitorsInRoom?.length > 0) {
          const monitorListDiv = createEl('div', CSS_CLASSES.MONITOR_LIST);
          
          // 방의 크기(colSpan)에 따라 모니터 그리드 열 수 조정
          // colSpan이 클수록 더 많은 열을 표시
          const colSpan = roomData.colSpan || 1;
          // 모니터 하나당 약 90px 너비를 고려, 100px 셀 너비 기준으로 몇 개 들어갈지 계산
          const adjustedColumns = Math.max(1, Math.min(4, colSpan));
          monitorListDiv.style.gridTemplateColumns = `repeat(${adjustedColumns}, 1fr)`;
          
          monitorsInRoom.forEach(monitor => {
            monitorListDiv.appendChild(createMonitorCubeElement(monitor, displayKey));
          });
          cubeDiv.appendChild(monitorListDiv);
        }
      }
      return cubeDiv;
    }

    function renderFloor(floorData, index, monitorCounts, monitorsByLocation, monitorsCountPerFloor) {
        const sectionDiv = createEl('div', CSS_CLASSES.FLOOR_SECTION);
        sectionDiv.id = `section-${floorData.label.replace(/[^a-zA-Z0-9]/g, '') || index}`;

        const labelDiv = createEl('div', CSS_CLASSES.SECTION_LABEL);
        const floorCountData = monitorsCountPerFloor[floorData.label];
        const floorCountStr = formatCountString(floorCountData);
        setText(labelDiv, `${floorData.label}${floorCountStr ? ` ${floorCountStr}` : ''}`);
        sectionDiv.appendChild(labelDiv);

        const gridDiv = createEl('div', CSS_CLASSES.GRID_CONTAINER);
        gridDiv.style.setProperty('--floor-cols', floorData.columns);

        floorData.rooms?.forEach(roomData => {
            gridDiv.appendChild(createCubeElement(roomData, false, floorData.label, monitorCounts, monitorsByLocation));
        });
        floorData.corridors?.forEach(corridorData => {
            gridDiv.appendChild(createCubeElement(corridorData, true, floorData.label, monitorCounts, monitorsByLocation));
        });

        appendChilds(sectionDiv, [gridDiv]);
        appendChilds(floorPlanContainer, [sectionDiv]);
    }

    function renderLostSection(lostMonitors) {
        if (lostMonitors.length === 0) return;

        const sectionDiv = createEl('div', CSS_CLASSES.FLOOR_SECTION);
        sectionDiv.id = 'section-lost';

        const labelDiv = createEl('div', CSS_CLASSES.SECTION_LABEL);
        setText(labelDiv, `${LOST_LOCATION_LABEL} (${lostMonitors.length})`);
        sectionDiv.appendChild(labelDiv);

        const groupedLostMonitors = lostMonitors.reduce((acc, monitor) => {
            const prevLocation = monitor.previous || UNKNOWN_VALUE;
            if (!acc[prevLocation]) acc[prevLocation] = [];
            acc[prevLocation].push(monitor);
            return acc;
        }, {});
        
        // 사라진 모니터 그룹의 수에 따라 컬럼 수 계산
        const groupCount = Object.keys(groupedLostMonitors).length;
        // 그룹 개수가 9보다 적으면 그룹 개수만큼, 9 이상이면 최대 9개 컬럼 사용
        const columnCount = Math.min(groupCount, 9);

        const gridDiv = createEl('div', CSS_CLASSES.LOST_MONITORS_GRID);
        // 그리드 컬럼 수 동적 설정
        gridDiv.style.setProperty('--lost-cols', columnCount);
        gridDiv.style.gridTemplateColumns = `repeat(${columnCount}, 100px)`;
        
        // 섹션 div의 너비를 컬럼 수에 맞게 조정
        const columnWidth = 100; // 각 열의 너비
        const gapWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-gap')) || 3; // 간격
        const paddingWidth = (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-gap')) || 3) * 2; // 양쪽 패딩
        const borderWidth = 2; // 테두리 너비 2px (왼쪽 1px + 오른쪽 1px)
        
        // 전체 그리드 너비 계산: 열 너비 * 열 수 + 간격 * (열 수 - 1) + 패딩 + 테두리
        const gridTotalWidth = (columnWidth * columnCount) + (gapWidth * (columnCount - 1)) + paddingWidth + borderWidth;
        
        // 섹션에 적용할 최대 너비 (섹션 패딩 고려)
        const sectionPadding = 44; // 양쪽 22px + 22px
        sectionDiv.style.maxWidth = `${gridTotalWidth + sectionPadding}px`;

        Object.keys(groupedLostMonitors).sort().forEach(prevLocation => {
            const locationCube = createEl('div', CSS_CLASSES.LOST_LOCATION_CUBE);

            const locationNameDiv = createEl('div', CSS_CLASSES.LOST_LOCATION_NAME);
            let prevLocationDisplay = prevLocation;
            const prevLocationInfo = validLocations.get(prevLocation);
            if (prevLocationInfo) {
                prevLocationDisplay = `${prevLocationInfo.label} ${prevLocationInfo.name}`;
            }
            setText(locationNameDiv, `[이전] ${prevLocationDisplay}`);
            locationCube.appendChild(locationNameDiv);

            const monitorListDiv = createEl('div', CSS_CLASSES.LOST_MONITOR_LIST);
            // 사라진 모니터도 가로 배치 적용
            monitorListDiv.style.display = 'grid';
            monitorListDiv.style.gridTemplateColumns = 'repeat(auto-fill, minmax(90px, 1fr))';
            
            groupedLostMonitors[prevLocation].forEach(monitor => {
                monitorListDiv.appendChild(createMonitorCubeElement(monitor, LOST_LOCATION_LABEL));
            });
            locationCube.appendChild(monitorListDiv);

            gridDiv.appendChild(locationCube);
        });

        appendChilds(sectionDiv, [gridDiv]);
        appendChilds(floorPlanContainer, [sectionDiv]);
    }

    function renderUI(monitorData) {
        floorPlanContainer.innerHTML = '';

        schoolLayoutData.forEach((floorData, index) => {
            renderFloor(floorData, index, monitorData.monitorCounts, monitorData.monitorsByLocation, monitorData.monitorsCountPerFloor);
             if (index < schoolLayoutData.length - 1) {
                const divider = createEl('hr', CSS_CLASSES.SECTION_DIVIDER);
                floorPlanContainer.appendChild(divider);
             }
        });

        if (monitorData.lostMonitors.length > 0) {
            const divider = createEl('hr', CSS_CLASSES.SECTION_DIVIDER);
            floorPlanContainer.appendChild(divider);
            renderLostSection(monitorData.lostMonitors);
        }

        adjustRowHeights();
        scaleLayout();
    }

    function adjustRowHeights() {
      requestAnimationFrame(() => {
        const gridContainers = document.querySelectorAll(`.${CSS_CLASSES.GRID_CONTAINER}, .${CSS_CLASSES.LOST_MONITORS_GRID}`);
        const defaultMinHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cube-min-height')) || 60;

        gridContainers.forEach(grid => {
          let maxRow = 0;
          const rowElements = {};

          grid.querySelectorAll(`.${CSS_CLASSES.CUBE}[data-row], .${CSS_CLASSES.LOST_LOCATION_CUBE}`).forEach(cube => {
            if (cube.classList.contains(CSS_CLASSES.LOST_LOCATION_CUBE)) {
                const rowKey = 'lost';
                if (!rowElements[rowKey]) rowElements[rowKey] = [];
                rowElements[rowKey].push(cube);
                maxRow = Math.max(maxRow, 1);
                return;
            }

            const startRow = parseInt(cube.dataset.row, 10) || 0;
            const rowSpan = parseInt(cube.style.gridRowEnd?.replace('span ', '')) || 1;
            const endRow = startRow + rowSpan - 1;

            for (let r = startRow; r <= endRow; r++) {
                const rowKey = r.toString();
                if (!rowElements[rowKey]) rowElements[rowKey] = [];
                rowElements[rowKey].push(cube);
            }
            maxRow = Math.max(maxRow, endRow);
          });

          if (!maxRow) return;

          for (let r = 1; r <= maxRow; r++) {
            const rowKey = r.toString();
            const cubesInRow = rowElements[rowKey] || [];
            if (cubesInRow.length === 0) continue;

            let maxHeightInRow = defaultMinHeight;
            cubesInRow.forEach(cube => {
              cube.style.minHeight = '';
              maxHeightInRow = Math.max(maxHeightInRow, cube.offsetHeight);
            });
            cubesInRow.forEach(cube => {
              const currentMinHeight = parseInt(cube.style.minHeight) || 0;
              cube.style.minHeight = `${Math.max(maxHeightInRow, currentMinHeight, defaultMinHeight)}px`;
            });
          }

           const lostCubes = rowElements['lost'] || [];
           if (lostCubes.length > 0) {
               let maxLostHeight = defaultMinHeight;
               lostCubes.forEach(cube => { cube.style.minHeight = ''; maxLostHeight = Math.max(maxLostHeight, cube.offsetHeight); });
               lostCubes.forEach(cube => { cube.style.minHeight = `${Math.max(maxLostHeight, defaultMinHeight)}px`; });
           }
        });
      });
    }

    function scaleLayout() {
      const container = document.getElementById(DOM_IDS.FLOOR_PLAN_CONTAINER);
      if (!container) return;

      container.style.transform = 'scale(1)';
      const containerWidth = container.scrollWidth;
      const windowWidth = window.innerWidth;
      const availableWidth = windowWidth - 40;

      let scale = 1;
      if (containerWidth > availableWidth) {
          scale = availableWidth / containerWidth;
      }
      container.style.transform = `scale(${scale})`;
    }

    function debounce(func, wait) {
         clearTimeout(resizeTimeout);
         resizeTimeout = setTimeout(func, wait);
    }

    function showLoadingState(isLoading, message = "데이터 로딩 중...") {
        setButtonDisabled(refreshButton, isLoading);
        setButtonDisabled(downloadButton, isLoading);
        setButtonDisabled(sheetButton, isLoading);
        if (isLoading) {
            setText(loadingMessage, message);
            showElement(loadingMessage);
            hideElement(errorMessage);
        } else {
            hideElement(loadingMessage);
        }
    }

    function showError(message) {
        setText(errorMessage, `오류 발생:\n${message}`);
        showElement(errorMessage);
        setButtonDisabled(downloadButton, true);
    }

    function isPdfSupportedBrowser() {
        const platform = navigator.platform.toLowerCase();
        const userAgent = navigator.userAgent.toLowerCase();
        const isWindowsOrMac = platform.startsWith('win') || platform.startsWith('mac');
        const isChromeOrFirefox = userAgent.includes('chrome') || userAgent.includes('firefox');
        const isMobile = /mobi|android|iphone|ipad|ipod/i.test(userAgent);
        return isWindowsOrMac && isChromeOrFirefox && !isMobile;
    }
    function setOverlayText(text) { setText(pdfOverlayText, text); }
    function toggleOverlay(visible) { if (visible) pdfOverlay.classList.add(CSS_CLASSES.VISIBLE); else pdfOverlay.classList.remove(CSS_CLASSES.VISIBLE); }
    function togglePdfMode(enable) {
        setButtonDisabled(downloadButton, enable);
        setButtonDisabled(refreshButton, enable);
        setButtonDisabled(sheetButton, enable);
        toggleOverlay(enable);

        if (enable) {
            setOverlayText('PDF 생성 준비 중...');
            document.body.classList.add(CSS_CLASSES.PDF_CAPTURE_MODE);
            floorPlanContainer.style.transform = 'scale(1)';
            
            // PDF 모드에서도 그리드 레이아웃 유지
            document.querySelectorAll(`.${CSS_CLASSES.MONITOR_LIST}, .${CSS_CLASSES.LOST_MONITOR_LIST}`).forEach(list => {
                if (list.style.gridTemplateColumns) {
                    list.dataset.originalColumns = list.style.gridTemplateColumns;
                }
            });
            
            // Corridor 요소들이 PDF에서 확실히 보이도록 스타일 강제 적용
            document.querySelectorAll(`.${CSS_CLASSES.CORRIDOR}`).forEach(corridor => {
                corridor.style.visibility = 'visible';
                corridor.style.display = 'flex';
                corridor.style.opacity = '1';
                corridor.style.minWidth = '100px';
                corridor.style.minHeight = '60px';
                corridor.style.border = '2px dashed #aaaaaa';
                corridor.dataset.pdfModified = 'true';
            });
            
            // 일반 큐브 요소들도 확실히 보이도록 설정
            document.querySelectorAll(`.${CSS_CLASSES.CUBE}:not(.${CSS_CLASSES.CORRIDOR})`).forEach(cube => {
                cube.style.visibility = 'visible';
                cube.style.display = 'flex';
                cube.style.opacity = '1';
                cube.style.minWidth = '100px';
                cube.style.minHeight = '60px';
                cube.dataset.pdfModified = 'true';
            });
            
            // 그리드 컨테이너도 보이도록 설정
            document.querySelectorAll(`.${CSS_CLASSES.GRID_CONTAINER}, .${CSS_CLASSES.LOST_MONITORS_GRID}`).forEach(grid => {
                grid.style.visibility = 'visible';
                grid.style.display = 'grid';
                grid.style.opacity = '1';
                grid.style.minWidth = '300px';
                grid.dataset.pdfModified = 'true';
            });
        } else {
            document.body.classList.remove(CSS_CLASSES.PDF_CAPTURE_MODE);
            scaleLayout();
            
            // 원래 그리드 레이아웃 복원
            document.querySelectorAll(`.${CSS_CLASSES.MONITOR_LIST}, .${CSS_CLASSES.LOST_MONITOR_LIST}`).forEach(list => {
                if (list.dataset.originalColumns) {
                    list.style.gridTemplateColumns = list.dataset.originalColumns;
                    delete list.dataset.originalColumns;
                }
            });
            
            // PDF를 위해 수정된 스타일 복원
            document.querySelectorAll('[data-pdf-modified="true"]').forEach(el => {
                el.style.visibility = '';
                el.style.display = '';
                el.style.opacity = '';
                el.style.minWidth = '';
                el.style.minHeight = '';
                el.style.border = '';
                delete el.dataset.pdfModified;
            });
        }
    }
    async function captureSections(sections) {
         const capturedCanvases = [];
         const sectionDimensions = [];
         setOverlayText(`레이아웃 캡처 중... (1/${sections.length})`);
         
         // html2canvas 옵션 설정
         const html2canvasOptions = {
             scale: 3, // 고품질 캡처
             useCORS: true,
             logging: false,
             backgroundColor: '#ffffff',
             allowTaint: true,
             letterRendering: true,
             removeContainer: false,
             ignoreElements: element => false, // 모든 요소 포함
             onclone: (document, clone) => {
                 // 클론된 문서의 모든 텍스트 내용이 제대로 보이도록 설정
                 const allElements = clone.querySelectorAll('*');
                 allElements.forEach(el => {
                     if (el.style) {
                        el.style.fontFamily = "'goorm-sans-bold', Arial, sans-serif";
                        el.style.visibility = 'visible';
                        el.style.opacity = '1';
                     }
                 });
                
                 // 클론에서 모든 큐브 이름과 모니터 ID 등의 텍스트가 보이도록 확인
                 const textElements = clone.querySelectorAll('.cube-name-text, .monitor-cube, .section-label, .lost-location-name');
                 textElements.forEach(el => {
                     el.style.fontFamily = "'goorm-sans-bold', Arial, sans-serif";
                     el.style.visibility = 'visible';
                     el.style.opacity = '1';
                     el.style.display = 'block';
                     el.style.color = '#000000';
                     
                     // 텍스트가 너무 작지 않도록 조정
                     if (el.classList.contains('cube-name-text')) {
                         el.style.fontSize = '14px';
                         el.style.fontWeight = 'bold';
                         el.style.textShadow = '0px 0px 1px #ffffff';
                     } else if (el.classList.contains('monitor-cube')) {
                         el.style.fontSize = '12px';
                         el.style.fontWeight = 'bold';
                         el.style.border = 'none'; // 테두리 제거
                         el.style.boxShadow = 'none'; // 그림자 제거
                         
                         // 상태 클래스에 따른 스타일 강화 (테두리 없이)
                         if (el.classList.contains('status-green')) {
                             el.style.backgroundColor = '#E8F5E9';
                             el.style.border = 'none';
                             el.style.color = '#1B5E20';
                         } else if (el.classList.contains('status-red')) {
                             el.style.backgroundColor = '#FFEBEE';
                             el.style.border = 'none';
                             el.style.color = '#B71C1C';
                         } else if (el.classList.contains('status-yellow')) {
                             el.style.backgroundColor = '#FFFDE7';
                             el.style.border = 'none';
                             el.style.color = '#F57F17';
                         } else if (el.classList.contains('status-blue')) {
                             el.style.backgroundColor = '#E3F2FD';
                             el.style.border = 'none';
                             el.style.color = '#0D47A1';
                         } else if (el.classList.contains('status-orange')) {
                             el.style.backgroundColor = '#FFF3E0';
                             el.style.border = 'none';
                             el.style.color = '#E65100';
                         }
                     }
                 });
                 
                 // 레이블(제목)도 확실히 보이게 설정
                 const labels = clone.querySelectorAll('.section-label');
                 labels.forEach(label => {
                     label.style.fontSize = '24px';
                     label.style.fontWeight = 'bold';
                     label.style.marginBottom = '15px';
                     label.style.textAlign = 'center';
                     label.style.color = '#000000';
                     label.style.fontFamily = "'Freesentation-9Black', Arial, sans-serif";
                     label.style.letterSpacing = 'normal';
                 });
                 
                 // 내용이 잘 보이도록 텍스트만 강조
                 const monitorCubes = clone.querySelectorAll('.monitor-cube');
                 monitorCubes.forEach(cube => {
                     cube.style.textShadow = '0 0 1px white';
                     cube.style.boxShadow = 'none';
                     cube.style.border = 'none';
                 });
                 
                 // 교실 이름도 확실히 보이게 설정
                 const lostLocationNames = clone.querySelectorAll('.lost-location-name');
                 lostLocationNames.forEach(name => {
                     name.style.fontWeight = 'bold';
                     name.style.fontSize = '12px';
                     name.style.color = '#000000';
                     name.style.textShadow = '0 0 1px white';
                 });
             }
         };
         
         // 모든 섹션에 캡처 전 스타일 적용
         sections.forEach(section => {
             section.style.visibility = 'visible';
             section.style.opacity = '1';
             section.style.display = 'block';
             
             // 섹션 내 모든 텍스트 요소가 잘 보이도록 설정
             const textElements = section.querySelectorAll('.cube-name-text, .monitor-cube, .section-label, .lost-location-name');
             textElements.forEach(el => {
                 el.style.visibility = 'visible';
                 el.style.opacity = '1';
                 el.dataset.originalDisplay = el.style.display || '';
                 el.style.display = el.tagName === 'SPAN' ? 'inline-block' : 'block';
             });
             
             // 모니터 박스 테두리 제거
             const monitorBoxes = section.querySelectorAll('.monitor-cube');
             monitorBoxes.forEach(box => {
                 box.dataset.originalBorder = box.style.border || '';
                 box.dataset.originalBoxShadow = box.style.boxShadow || '';
                 box.style.border = 'none';
                 box.style.boxShadow = 'none';
             });
             
             // corridor 요소들도 확인
             const corridors = section.querySelectorAll(`.${CSS_CLASSES.CORRIDOR}`);
             corridors.forEach(corridor => {
                 corridor.style.visibility = 'visible';
                 corridor.style.display = 'flex';
                 corridor.style.border = '3px dashed #777777';
             });
             
             // 그리드 요소들이 제대로 표시되는지 확인
             const grids = section.querySelectorAll(`.${CSS_CLASSES.GRID_CONTAINER}, .${CSS_CLASSES.LOST_MONITORS_GRID}`);
             grids.forEach(grid => {
                 grid.style.visibility = 'visible';
                 grid.style.display = 'grid';
             });
         });
         
         // 강제로 레이아웃 재계산 수행
         document.body.offsetHeight;
         
         // 렌더링 안정화를 위한 대기
         await new Promise(resolve => setTimeout(resolve, 800));
         
         // 각 섹션 캡처
         for (let i = 0; i < sections.length; i++) {
             setOverlayText(`레이아웃 캡처 중... (${i + 1}/${sections.length})`);
             const section = sections[i];
             
             // 추가 옵션 설정 - 섹션별 크기 조정
             const options = {
                 ...html2canvasOptions,
                 windowWidth: section.scrollWidth + 100,
                 windowHeight: section.scrollHeight + 100
             };
             
             // 캡처 직전 잠시 대기
             await new Promise(resolve => setTimeout(resolve, 200));
             
             // 캡처 수행
             try {
                 const canvas = await html2canvas(section, options);
                 capturedCanvases.push(canvas);
                 sectionDimensions.push({ width: canvas.width / 3, height: canvas.height / 3 });
             } catch (error) {
                 console.error('섹션 캡처 중 오류:', error);
                 // 오류가 발생해도 계속 진행
                 const placeholder = document.createElement('canvas');
                 placeholder.width = 300 * 3;
                 placeholder.height = 200 * 3;
                 const ctx = placeholder.getContext('2d');
                 ctx.fillStyle = '#ffffff';
                 ctx.fillRect(0, 0, placeholder.width, placeholder.height);
                 ctx.fillStyle = '#ff0000';
                 ctx.font = '30px sans-serif';
                 ctx.fillText(`섹션 ${i+1} 캡처 실패`, 50, 100);
                 capturedCanvases.push(placeholder);
                 sectionDimensions.push({ width: 300, height: 200 });
             }
         }
         
         // 원래 스타일로 복원
         sections.forEach(section => {
             const textElements = section.querySelectorAll('[data-original-display]');
             textElements.forEach(el => {
                 el.style.display = el.dataset.originalDisplay;
                 delete el.dataset.originalDisplay;
             });
             
             // 모니터 박스 스타일 복원
             const monitorBoxes = section.querySelectorAll('.monitor-cube');
             monitorBoxes.forEach(box => {
                 if (box.dataset.originalBorder !== undefined) {
                     box.style.border = box.dataset.originalBorder;
                     delete box.dataset.originalBorder;
                 }
                 if (box.dataset.originalBoxShadow !== undefined) {
                     box.style.boxShadow = box.dataset.originalBoxShadow;
                     delete box.dataset.originalBoxShadow;
                 }
             });
             
             // corridor 스타일 복원
             const corridors = section.querySelectorAll(`.${CSS_CLASSES.CORRIDOR}`);
             corridors.forEach(corridor => {
                 corridor.style.border = '';
             });
         });
         
         return { capturedCanvases, sectionDimensions };
    }
    function calcPdfScale(sectionDimensions, contentWidth, contentHeight) {
        let maxWidthSection = { width: 0, height: 0, index: -1 };
        let maxHeightSection = { width: 0, height: 0, index: -1 };

        // 모든 섹션 중에서 가장 넓은 섹션과 가장 높은 섹션 찾기
        sectionDimensions.forEach((dim, index) => {
            if (dim.width > maxWidthSection.width) {
                maxWidthSection = { ...dim, index };
            }
            if (dim.height > maxHeightSection.height) {
                maxHeightSection = { ...dim, index };
            }
        });

        // 유효한 섹션 크기가 없으면 기본 스케일 반환
        if (maxWidthSection.width === 0 || maxHeightSection.height === 0) {
            console.warn("유효한 섹션 크기를 찾을 수 없습니다. 기본 스케일 1.0 반환.");
            return 1.0;
        }

        // 1. 가장 넓은 섹션이 용지에 맞도록 하는 최대 스케일 계산
        //    (가로, 세로 비율 모두 고려하여 용지 콘텐츠 영역 안에 들어가야 함)
        const scaleForMaxWidthSectionFitW = contentWidth / maxWidthSection.width;
        const scaleForMaxWidthSectionFitH = contentHeight / maxWidthSection.height;
        const scaleForMaxWidthSection = Math.min(scaleForMaxWidthSectionFitW, scaleForMaxWidthSectionFitH);

        // 2. 가장 높은 섹션이 용지에 맞도록 하는 최대 스케일 계산
        //    (가로, 세로 비율 모두 고려하여 용지 콘텐츠 영역 안에 들어가야 함)
        const scaleForMaxHeightSectionFitW = contentWidth / maxHeightSection.width;
        const scaleForMaxHeightSectionFitH = contentHeight / maxHeightSection.height;
        const scaleForMaxHeightSection = Math.min(scaleForMaxHeightSectionFitW, scaleForMaxHeightSectionFitH);

        // 3. 두 스케일 중 더 작은 값을 최종 스케일로 선택
        //    이렇게 해야 가장 넓은 섹션과 가장 높은 섹션 모두 용지 안에 들어감
        const finalScale = Math.min(scaleForMaxWidthSection, scaleForMaxHeightSection);

        console.log(`PDF 스케일 계산:`);
        console.log(` - 용지 콘텐츠 영역: ${contentWidth.toFixed(1)}mm x ${contentHeight.toFixed(1)}mm`);
        console.log(` - 가장 넓은 섹션 (${maxWidthSection.index}): ${maxWidthSection.width.toFixed(1)}x${maxWidthSection.height.toFixed(1)}, 필요 스케일 <= ${scaleForMaxWidthSection.toFixed(3)}`);
        console.log(` - 가장 높은 섹션 (${maxHeightSection.index}): ${maxHeightSection.width.toFixed(1)}x${maxHeightSection.height.toFixed(1)}, 필요 스케일 <= ${scaleForMaxHeightSection.toFixed(3)}`);
        console.log(` - 최종 선택된 스케일: ${finalScale.toFixed(3)}`);

        // 기존의 추가 여백(0.9 곱하기)이나 최소 스케일 제한(0.65)은 사용하지 않음
        // 필요하다면 여기에 로직을 추가할 수 있습니다. 예: finalScale * 0.95
        return finalScale;
    }
    function addImagesToPdf(pdf, canvases, dimensions, optimalScale, config) {
        const { margin, contentWidth, pageHeight, sectionGap } = config;
        let currentPageHeightUsed = margin;
        let isFirstSectionOnPage = true;

        setOverlayText('PDF 페이지 생성 중...');
        for (let i = 0; i < canvases.length; i++) {
            const canvas = canvases[i];
            const originalWidth = dimensions[i].width;
            const originalHeight = dimensions[i].height;
            const finalWidth = originalWidth * optimalScale;
            const finalHeight = originalHeight * optimalScale;

            const requiredHeight = (isFirstSectionOnPage ? 0 : sectionGap) + finalHeight;

            // 새 페이지가 필요한지 확인
            if (!isFirstSectionOnPage && (currentPageHeightUsed + requiredHeight > pageHeight - margin)) {
                pdf.addPage();
                currentPageHeightUsed = margin;
                isFirstSectionOnPage = true;
            }

            // 중앙 정렬을 위한 X 위치 계산
            let positionY = currentPageHeightUsed + (isFirstSectionOnPage ? 0 : sectionGap);
            const positionX = margin + (contentWidth - finalWidth) / 2;

            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', positionX, positionY, finalWidth, finalHeight);

            // 페이지 내 다음 섹션을 위한 위치 업데이트
            currentPageHeightUsed = positionY + finalHeight;
            
            isFirstSectionOnPage = false;
        }
    }

    async function generatePDF(orientation = 'p') {
      if (!isPdfSupportedBrowser()) {
          alert("PDF 다운로드 기능은 데스크탑 환경의 Chrome 또는 Firefox 브라우저에서만 원활하게 작동합니다.");
          return;
      }

      togglePdfMode(true);
      
      try {
        // 레이아웃이 완전히 적용될 수 있도록 더 긴 대기 시간
        setOverlayText('PDF 레이아웃 준비 중...');
        
        // 웹 폰트가 로드되었는지 확인
        await new Promise(resolve => {
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
              console.log('폰트 로드 완료');
              resolve();
            });
          } else {
            setTimeout(resolve, 1000); // 폰트 로드를 위한 대기 시간
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const isLandscape = orientation === 'l';
        const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const contentWidth = pageWidth - margin * 2;
        const contentHeight = pageHeight - margin * 2;
        const sectionGap = 15; // 구분선 포함 여백 늘림

        const sections = Array.from(document.querySelectorAll(`.${CSS_CLASSES.FLOOR_SECTION}`));
        if (sections.length === 0) {
            throw new Error("PDF로 변환할 내용이 없습니다.");
        }
        
        // 모니터 상태 색상 정보 가져오기
        const statusColors = getStatusColors();
        
        // 모든 모니터 요소의 내용이 잘 보이도록 텍스트 색상 강조
        const allMonitors = document.querySelectorAll(`.${CSS_CLASSES.MONITOR_CUBE}`);
        allMonitors.forEach(monitor => {
            monitor.dataset.originalColor = monitor.style.color || '';
            monitor.dataset.originalBorder = monitor.style.border || '';
            monitor.dataset.originalBoxShadow = monitor.style.boxShadow || '';
            
            monitor.style.color = '#000000';
            monitor.style.fontWeight = 'bold';
            monitor.style.border = 'none';
            monitor.style.boxShadow = 'none';
            
            // 상태별 색상 강화 (테두리 없이)
            if (monitor.classList.contains('status-green')) {
                monitor.style.backgroundColor = statusColors.green.bg;
                monitor.style.border = 'none';
                monitor.style.color = statusColors.green.text;
            } else if (monitor.classList.contains('status-red')) {
                monitor.style.backgroundColor = statusColors.red.bg;
                monitor.style.border = 'none';
                monitor.style.color = statusColors.red.text;
            } else if (monitor.classList.contains('status-yellow')) {
                monitor.style.backgroundColor = statusColors.yellow.bg;
                monitor.style.border = 'none';
                monitor.style.color = statusColors.yellow.text;
            } else if (monitor.classList.contains('status-blue')) {
                monitor.style.backgroundColor = statusColors.blue.bg;
                monitor.style.border = 'none';
                monitor.style.color = statusColors.blue.text;
            } else if (monitor.classList.contains('status-orange')) {
                monitor.style.backgroundColor = statusColors.orange.bg;
                monitor.style.border = 'none';
                monitor.style.color = statusColors.orange.text;
            }
        });
        
        // 모든 방 이름 요소의 내용이 잘 보이도록 강조
        const allRoomNames = document.querySelectorAll(`.${CSS_CLASSES.CUBE_NAME_TEXT}`);
        allRoomNames.forEach(roomName => {
            roomName.dataset.originalStyle = roomName.getAttribute('style') || '';
            roomName.style.color = '#000000';
            roomName.style.fontWeight = 'bold';
            roomName.style.fontSize = '14px';
            roomName.style.textShadow = '0px 0px 1px #ffffff';
            roomName.style.fontFamily = "'goorm-sans-bold', Arial, sans-serif";
        });
        
        // 교실 이름 강조
        const allLocationNames = document.querySelectorAll(`.${CSS_CLASSES.LOST_LOCATION_NAME}`);
        allLocationNames.forEach(name => {
            name.dataset.originalStyle = name.getAttribute('style') || '';
            name.style.color = '#000000';
            name.style.fontWeight = 'bold';
            name.style.fontSize = '12px';
            name.style.fontFamily = "'goorm-sans-bold', Arial, sans-serif";
        });
        
        // 층 제목 스타일 적용
        const allSectionLabels = document.querySelectorAll(`.${CSS_CLASSES.SECTION_LABEL}`);
        allSectionLabels.forEach(label => {
            label.dataset.originalStyle = label.getAttribute('style') || '';
            label.style.color = '#000000';
            label.style.fontWeight = 'bold';
            label.style.fontSize = '24px';
            label.style.fontFamily = "'Freesentation-9Black', Arial, sans-serif";
        });
        
        // PDF 캡처 전 레이아웃 강제 재계산
        setOverlayText('레이아웃 최적화 중...');

        // 전체 컨테이너를 강제로 다시 그리기
        floorPlanContainer.style.opacity = '0.99';
        floorPlanContainer.offsetHeight; // 강제 리플로우
        floorPlanContainer.style.opacity = '1';
        
        // 모든 섹션과 그리드 요소들을 강제로 다시 그리기
        sections.forEach(section => {
            // 각 섹션을 잠시 숨겼다가 다시 표시
            section.style.display = 'none';
            section.offsetHeight; // 강제 리플로우
            section.style.display = '';
            
            // 그리드 컨테이너 내부의 요소들도 재계산
            const grids = section.querySelectorAll(`.${CSS_CLASSES.GRID_CONTAINER}, .${CSS_CLASSES.LOST_MONITORS_GRID}`);
            grids.forEach(grid => {
                // Corridor와 큐브 요소들 확인
                const corridors = grid.querySelectorAll(`.${CSS_CLASSES.CORRIDOR}`);
                corridors.forEach(corridor => {
                    corridor.style.visibility = 'visible';
                    corridor.style.display = 'flex';
                    corridor.style.minHeight = '60px';
                    corridor.style.minWidth = '100px';
                });
                
                // 모든 큐브 요소 표시 확인
                const cubes = grid.querySelectorAll(`.${CSS_CLASSES.CUBE}`);
                cubes.forEach(cube => {
                    cube.style.visibility = 'visible';
                    cube.style.minWidth = '100px';
                });
            });
        });
        
        // 레이아웃 안정화를 위한 추가 대기
        await new Promise(resolve => setTimeout(resolve, 800));

        const { capturedCanvases, sectionDimensions } = await captureSections(sections);
        
        // 원래 스타일 복원
        allMonitors.forEach(monitor => {
            if (monitor.dataset.originalColor !== undefined) {
                monitor.style.color = monitor.dataset.originalColor;
                delete monitor.dataset.originalColor;
            }
            if (monitor.dataset.originalBorder !== undefined) {
                monitor.style.border = monitor.dataset.originalBorder;
                delete monitor.dataset.originalBorder;
            }
            if (monitor.dataset.originalBoxShadow !== undefined) {
                monitor.style.boxShadow = monitor.dataset.originalBoxShadow;
                delete monitor.dataset.originalBoxShadow;
            }
            monitor.style.backgroundColor = '';
            monitor.style.fontWeight = '';
        });
        
        allRoomNames.forEach(roomName => {
            if (roomName.dataset.originalStyle !== undefined) {
                roomName.setAttribute('style', roomName.dataset.originalStyle);
                delete roomName.dataset.originalStyle;
            }
        });
        
        allLocationNames.forEach(name => {
            if (name.dataset.originalStyle !== undefined) {
                name.setAttribute('style', name.dataset.originalStyle);
                delete name.dataset.originalStyle;
            }
        });
        
        allSectionLabels.forEach(label => {
            if (label.dataset.originalStyle !== undefined) {
                label.setAttribute('style', label.dataset.originalStyle);
                delete label.dataset.originalStyle;
            }
        });
        
        // 모든 층에 동일한 스케일 적용 (용지 방향 고려 불필요, contentWidth/Height로 계산됨)
        const optimalScale = calcPdfScale(sectionDimensions, contentWidth, contentHeight);
        
        // 콘솔에 디버그 정보 출력
        console.log(`PDF 생성 정보 - 방향: ${isLandscape ? '가로' : '세로'}, 최종 스케일: ${optimalScale.toFixed(3)}`);
        
        addImagesToPdf(pdf, capturedCanvases, sectionDimensions, optimalScale, { 
            margin, contentWidth, pageHeight, sectionGap 
        });

        setOverlayText('PDF 파일 저장 중...');
        const orientationText = isLandscape ? '가로' : '세로';
        pdf.save(`부광고등학교_모니터_현황_${orientationText}.pdf`);

      } catch (error) {
          console.error("PDF 생성 오류:", error);
          showError(`PDF 생성 중 오류가 발생했습니다: ${error.message}`);
      } finally {
          togglePdfMode(false);
          setTimeout(() => {
              setButtonDisabled(downloadButton, false);
              setButtonDisabled(refreshButton, false);
              setButtonDisabled(sheetButton, false);
          }, 500);
      }
    }

    async function loadAndRenderAllData() {
        showLoadingState(true, "레이아웃 데이터 로딩 중...");
        floorPlanContainer.innerHTML = '';
        hideElement(errorMessage);

        try {
            const rawLayoutData = await fetchSheetData(LAYOUT_SHEET_CSV_URL, '레이아웃');
            schoolLayoutData = parseLayoutData(rawLayoutData);
            if (schoolLayoutData.length === 0) {
                throw new Error("학교 레이아웃 데이터를 불러오지 못했습니다. 시트 형식을 확인하세요.");
            }
            buildValidLocations();

            showLoadingState(true, "모니터 데이터 로딩 중...");
            const rawMonitorData = await fetchSheetData(MONITOR_SHEET_CSV_URL, '모니터');
            if (rawMonitorData.length === 0) {
                console.warn("모니터 시트 데이터가 비어있습니다.");
            }

            const monitorData = processMonitorData(rawMonitorData);

            renderUI(monitorData);
            setButtonDisabled(downloadButton, false);

        } catch (error) {
            console.error("데이터 로딩/처리 오류:", error);
            showError(error.message);
        } finally {
            showLoadingState(false);
        }
    }

    function initializeApp() {
      refreshButton.addEventListener('click', loadAndRenderAllData);
      downloadButton.addEventListener('click', () => {
          const confirmResult = confirm("<pdf를 어떤 방향으로 생성하시겠습니까?>\n\n확인 버튼을 누르면 가로로 수락 버튼을 누르면 세로로 생성됩니다.");
          const orientation = confirmResult ? 'p' : 'l';
          generatePDF(orientation);
      });
      sheetButton.addEventListener('click', () => {
          window.open(SHEET_EDIT_URL, '_blank');
      });
      window.addEventListener('resize', () => debounce(scaleLayout, 250));
      loadAndRenderAllData();
    }

    // 모니터 상태 색상 추출 함수
    function getStatusColors() {
      const style = getComputedStyle(document.documentElement);
      return {
        green: {
          bg: style.getPropertyValue('--color-status-green-bg').trim(),
          text: style.getPropertyValue('--color-status-green-text').trim()
        },
        red: {
          bg: style.getPropertyValue('--color-status-red-bg').trim(),
          text: style.getPropertyValue('--color-status-red-text').trim()
        },
        yellow: {
          bg: style.getPropertyValue('--color-status-yellow-bg').trim(),
          text: style.getPropertyValue('--color-status-yellow-text').trim()
        },
        blue: {
          bg: style.getPropertyValue('--color-status-blue-bg').trim(),
          text: style.getPropertyValue('--color-status-blue-text').trim()
        },
        orange: {
          bg: style.getPropertyValue('--color-status-orange-bg').trim(),
          text: style.getPropertyValue('--color-status-orange-text').trim()
        }
      };
    }

    initializeApp();

  })(); 